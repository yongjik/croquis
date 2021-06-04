// A buffer for RGB image tile.

#include "croquis/rgb_buffer.h"

#include <stdint.h>  // uint32_t
#include <stdlib.h>  // posix_memalign, free
#include <math.h>  // ceilf

#include <immintrin.h>

#include <string>

#include "croquis/grayscale_buffer.h"
#include "croquis/util/avx_util.h"  // to_string (for debugging)
#include "croquis/util/macros.h"  // CHECK

// #define DEBUG_BITMAP

namespace croquis {

RgbBuffer::RgbBuffer(uint32_t color)
{
    // TODO: Refactor into its own helper class.
    {
        void *p;
        CHECK(posix_memalign(&p, 32, 32 * BLK_CNT * 2) == 0);
        hovermap = (__m256i *) p;
    }

    __m128i r = _mm_set1_epi8(color >> 16);
    __m128i g = _mm_set1_epi8(color >> 8);
    __m128i b = _mm_set1_epi8(color);

    for (int i = 0; i < BLK_CNT; i++) {
        buf[i * 3] = r;
        buf[i * 3 + 1] = g;
        buf[i * 3 + 2] = b;
    }

    for (int i = 0; i < BLK_CNT * 2; i++) {
        hovermap[i] = _mm256_set1_epi32(-1);
    }
}

RgbBuffer::~RgbBuffer()
{
    free(hovermap);
}

// Consider the red color.  The input values are:
//      Alpha [0, 255] - constant throughout a single call
//      Gray  [0, 255] - from `gray_buf`
//      R     [0, 255] - the red value to use
//      R0    [0, 255] - original pixel value in `this`
//
// Then, the output color should be:
//      R1 = R0 + (R - R0) * (Alpha * Gray) / (255 * 255).
//
// In order to compute it fast, we take some shortcut by first computing:
//      scaled_alpha = ceil(Alpha * 65536 / 255 * 255).
//
// Then we can compute R1 by:
//      R1 = R0 + (R - R0) * ((Gray * scaled_alpha) >> 16)
//
// Note that the shift operation cuts off the fractions, instead of rounding.
// To compensate, we use ceil() to compute `scaled_alpha`.  It might not be
// perfect, but it seems good enough.  (In particular, it gives exact result
// whenever Alpha = Gray = 255.)
void RgbBuffer::merge(GrayscaleBuffer *gray_buf, int line_id, uint32_t color)
{
    const __m128i zeros = _mm_setzero_si128();
    const __m256i L = _mm256_set1_epi32(line_id);

    int alpha = (color >> 24) & 0xff;
    int scaled_alpha = ceilf(alpha * (65536.f / 255.f / 255.f));
    const __m256i Alpha = _mm256_set1_epi16(scaled_alpha);

    const __m256i R = _mm256_set1_epi16((color >> 16) & 0xff);
    const __m256i G = _mm256_set1_epi16((color >> 8) & 0xff);
    const __m256i B = _mm256_set1_epi16(color & 0xff);

    const int blk_cnt = gray_buf->blk_cnt;
    for (int i = 0; i < blk_cnt; i++) {
        int offset = gray_buf->blklist[i];

        //----------------------------------------
        // First, update `hovermap`.

        __m128i Gray0 = gray_buf->buf[offset];
        __m256i Gray = _mm256_cvtepu8_epi16(Gray0);
        gray_buf->buf[offset] = zeros;

        // Zero iff the corresponding pixel is being updated.
        __m128i mask = _mm_cmpeq_epi8(Gray0, zeros);  // vpcmpeqb

        __m256i mask1 = _mm256_cvtepi8_epi32(mask);  // vpmovsxbd
        mask = _mm_bsrli_si128(mask, 8);  // vpsrldq
        __m256i mask2 = _mm256_cvtepi8_epi32(mask);  // vpmovsxbd

        __m256i H1 = hovermap[offset * 2];
        __m256i H2 = hovermap[offset * 2 + 1];

        // vpblendvb x2
        hovermap[offset * 2] = _mm256_blendv_epi8(L, H1, mask1);
        hovermap[offset * 2 + 1] = _mm256_blendv_epi8(L, H2, mask2);

        //----------------------------------------
        // Now update RGB colors in `buf`.

        // vpmovzxbw x3
        __m256i R0 = _mm256_cvtepu8_epi16(buf[offset * 3]);
        __m256i G0 = _mm256_cvtepu8_epi16(buf[offset * 3 + 1]);
        __m256i B0 = _mm256_cvtepu8_epi16(buf[offset * 3 + 2]);

        __m256i dR = _mm256_sub_epi16(R, R0);  // vpsubw
        __m256i dG = _mm256_sub_epi16(G, G0);  // vpsubw
        __m256i dB = _mm256_sub_epi16(B, B0);  // vpsubw

#ifdef DEBUG_BITMAP
        printf("color=%x Gray=%s\n    R0=%s\n    dR=%s\n",
               color, util::to_string(Gray).c_str(),
               util::to_string(R0).c_str(), util::to_string(dR).c_str());
#endif

        // Because `Gray` and `dR` are in the range [0, 255] and [-255, 255],
        // respectively, we can't just multiply them - it goes over 16bit range.
        // So we take absolute values, and remember the original, so that we can
        // apply the sign operation at the end.
        __m256i abs_dR = _mm256_abs_epi16(dR);  // vpabsw
        __m256i abs_dG = _mm256_abs_epi16(dG);  // vpabsw
        __m256i abs_dB = _mm256_abs_epi16(dB);  // vpabsw

#ifdef DEBUG_BITMAP
        printf("abs_dR=%s\n", util::to_string(abs_dR).c_str());
#endif

        // Compute Gray * (dR, dG, dB): result is unsigned, in range
        // [0, 255 * 255].
        abs_dR = _mm256_mullo_epi16(Gray, abs_dR);  // vpmullw
        abs_dG = _mm256_mullo_epi16(Gray, abs_dG);  // vpmullw
        abs_dB = _mm256_mullo_epi16(Gray, abs_dB);  // vpmullw

#ifdef DEBUG_BITMAP
        printf("after *Gray dR=%s\n", util::to_string(abs_dR).c_str());
#endif

        // Now multiply by the alpha value.
        abs_dR = _mm256_mulhi_epu16(Alpha, abs_dR);  // vpmulhuw
        abs_dG = _mm256_mulhi_epu16(Alpha, abs_dG);  // vpmulhuw
        abs_dB = _mm256_mulhi_epu16(Alpha, abs_dB);  // vpmulhuw

#ifdef DEBUG_BITMAP
        printf("after *Alpha dR=%s\n", util::to_string(abs_dR).c_str());
#endif

        // Apply back the sign.
        dR = _mm256_sign_epi16(abs_dR, dR);  // vpsignw
        dG = _mm256_sign_epi16(abs_dG, dG);  // vpsignw
        dB = _mm256_sign_epi16(abs_dB, dB);  // vpsignw

#ifdef DEBUG_BITMAP
        printf("after sign dR=%s\n", util::to_string(dR).c_str());
#endif

        // Add back the difference.
        __m256i R1 = _mm256_add_epi16(R0, dR);  // vpaddw
        __m256i G1 = _mm256_add_epi16(G0, dG);  // vpaddw
        __m256i B1 = _mm256_add_epi16(B0, dB);  // vpaddw

#ifdef DEBUG_BITMAP
        printf("R1=%s\n", util::to_string(dR).c_str());
#endif

        // Shuffle back to 8-bit values.
        const __m256i idxs = _mm256_set_epi32(
            0x00000000, 0x00000000, 0x0e0c0a08, 0x06040200,
            0x00000000, 0x00000000, 0x0e0c0a08, 0x06040200);
        R1 = _mm256_shuffle_epi8(R1, idxs);  // vpshufb
        G1 = _mm256_shuffle_epi8(G1, idxs);  // vpshufb
        B1 = _mm256_shuffle_epi8(B1, idxs);  // vpshufb

        // R1[0:63, 128:191] -> R1[0:63, 64:127], etc.
        R1 = _mm256_permute4x64_epi64(R1, 0x08);  // vpermq
        G1 = _mm256_permute4x64_epi64(G1, 0x08);  // vpermq
        B1 = _mm256_permute4x64_epi64(B1, 0x08);  // vpermq

        buf[offset * 3] = _mm256_castsi256_si128(R1);
        buf[offset * 3 + 1] = _mm256_castsi256_si128(G1);
        buf[offset * 3 + 2] = _mm256_castsi256_si128(B1);
    }

    // Clear the blocklist for `gray_buf`.
    gray_buf->blk_cnt = 0;
}

std::unique_ptr<UniqueMessageData>
RgbBuffer::make_png_data(const std::string &name) const
{
    // There are 256 rows.  Each row has one header byte signifying the
    // "filtering algorithm"[1] (we always use 2 "up", except for the first row
    // where we use 0 "none"), followed by 256 pixels, where each pixel is 3
    // bytes (RGB).
    //
    // [1] http://www.libpng.org/pub/png/spec/1.2/PNG-Filters.html
    auto msg = std::make_unique<UniqueMessageData>(name, (256 * 3 + 1) * 256);

    // For now, let's keep the code simple.
    //
    // `line_buf` holds six single-color lines.  The first three is for even
    // rows, and the next is for odd rows.  E.g., after processing line #0 and
    // #1:
    //      line_buf[0..255]    : line #0 R
    //      line_buf[256..511]  : line #0 G
    //      line_buf[512..767]  : line #0 B
    //      line_buf[768..1023] : line #1 R
    //      line_buf[1024..1279]: line #1 G
    //      line_buf[1280..1535]: line #1 B
    char line_buf[6 * 256];
    memset(line_buf, 0, sizeof(line_buf));

    char *dest = (char *) (msg->get());
    for (int row = 0; row < 256; row++) {
        *(dest++) = (row == 0) ? 0 : 2;

        char *this_line = line_buf + ((row % 2) ? 3 * 256 : 0);
        char *prev_line = line_buf + ((row % 2) ? 0 : 3 * 256);

        // Read the current row from blocks, and re-arrange them into three
        // lines (one each for R, G, B).
        char *line_ptr = this_line;
        char *src = (char *) buf + (64 * 16 * 3 * (row / 4)) + (4 * (row % 4));
        for (int i = 0; i < 256 / 4; i++) {
            memcpy(line_ptr, src, 4);  // R
            memcpy(line_ptr + 256, src + 16, 4);  // G
            memcpy(line_ptr + 512, src + 32, 4);  // B
            line_ptr += 4;
            src += 48;
        }

        // Compute the difference from the previous line and emit to `msg`.
        line_ptr = this_line;
        char *prev_ptr = prev_line;
        for (int i = 0; i < 256; i++) {
            // Emitting R, G, B.
            *(dest++) = ((uint8_t) line_ptr[0]) - ((uint8_t) prev_ptr[0]);
            *(dest++) = ((uint8_t) line_ptr[256]) - ((uint8_t) prev_ptr[256]);
            *(dest++) = ((uint8_t) line_ptr[512]) - ((uint8_t) prev_ptr[512]);

            line_ptr++;
            prev_ptr++;
        }
    }

    return msg;
}

std::unique_ptr<UniqueMessageData>
RgbBuffer::make_hovermap_data(const std::string &name) const
{
    auto msg =
        std::make_unique<UniqueMessageData>(name, 256 * 256 * sizeof(int));

    char *src = (char *) hovermap;
    char *dest = (char *) (msg->get());
    for (int row = 0; row < 256; row += 4) {
        for (int i = 0; i < 256 / 4; i++) {
            // Copy one 4x4 block.
            memcpy(dest, src, 16);
            memcpy(dest + 256 * 4 * 1, src + 16, 16);
            memcpy(dest + 256 * 4 * 2, src + 32, 16);
            memcpy(dest + 256 * 4 * 3, src + 48, 16);
            src += 64;
            dest += 16;
        }
        // Move to the next 4-row band.
        // (Note that we already advanced `dest` by one line (1024 bytes) in the
        // loop above, so we only need to add three more lines.)
        dest += 256 * 4 * 3;
    }

    return msg;
}

//------------------------------------------------

// Largely copied from RgbBuffer:merge().  See the comments at RgbaBuffer class
// for discussion.
//
// Note that `line_id` is unused here.
void RgbaBuffer::merge(GrayscaleBuffer *gray_buf, int line_id, uint32_t color)
{
    const __m128i zeros = _mm_setzero_si128();

    int alpha = (color >> 24) & 0xff;
    int scaled_alpha = ceilf(alpha * (65536.f / 255.f / 255.f));
    const __m256i Alpha = _mm256_set1_epi16(scaled_alpha);

    const __m256i R = _mm256_set1_epi16((color >> 16) & 0xff);
    const __m256i G = _mm256_set1_epi16((color >> 8) & 0xff);
    const __m256i B = _mm256_set1_epi16(color & 0xff);
    const __m256i W = _mm256_set1_epi16(0xff);

    const int blk_cnt = gray_buf->blk_cnt;
    for (int i = 0; i < blk_cnt; i++) {
        int offset = gray_buf->blklist[i];

        __m128i Gray0 = gray_buf->buf[offset];
        __m256i Gray = _mm256_cvtepu8_epi16(Gray0);
        gray_buf->buf[offset] = zeros;

        // vpmovzxbw x4
        __m256i R0 = _mm256_cvtepu8_epi16(buf[offset * 4]);
        __m256i G0 = _mm256_cvtepu8_epi16(buf[offset * 4 + 1]);
        __m256i B0 = _mm256_cvtepu8_epi16(buf[offset * 4 + 2]);
        __m256i W0 = _mm256_cvtepu8_epi16(buf[offset * 4 + 3]);

        __m256i dR = _mm256_sub_epi16(R, R0);  // vpsubw
        __m256i dG = _mm256_sub_epi16(G, G0);  // vpsubw
        __m256i dB = _mm256_sub_epi16(B, B0);  // vpsubw
        __m256i dW = _mm256_sub_epi16(W, W0);  // vpsubw

#ifdef DEBUG_BITMAP
        printf("color=%x Gray=%s\n    R0=%s\n    dR=%s\n",
               color, util::to_string(Gray).c_str(),
               util::to_string(R0).c_str(), util::to_string(dR).c_str());
#endif

        // Because `Gray` and `dR` are in the range [0, 255] and [-255, 255],
        // respectively, we can't just multiply them - it goes over 16bit range.
        // So we take absolute values, and remember the original, so that we can
        // apply the sign operation at the end.
        //
        // We don't need that for dW because W should always increase.
        __m256i abs_dR = _mm256_abs_epi16(dR);  // vpabsw
        __m256i abs_dG = _mm256_abs_epi16(dG);  // vpabsw
        __m256i abs_dB = _mm256_abs_epi16(dB);  // vpabsw
        __m256i abs_dW = dW;

#ifdef DEBUG_BITMAP
        printf("abs_dR=%s\n", util::to_string(abs_dR).c_str());
#endif

        // Compute Gray * (dR, dG, dB): result is unsigned, in range
        // [0, 255 * 255].
        abs_dR = _mm256_mullo_epi16(Gray, abs_dR);  // vpmullw
        abs_dG = _mm256_mullo_epi16(Gray, abs_dG);  // vpmullw
        abs_dB = _mm256_mullo_epi16(Gray, abs_dB);  // vpmullw
        abs_dW = _mm256_mullo_epi16(Gray, abs_dW);  // vpmullw

#ifdef DEBUG_BITMAP
        printf("after *Gray dR=%s\n", util::to_string(abs_dR).c_str());
#endif

        // Now multiply by the alpha value.
        abs_dR = _mm256_mulhi_epu16(Alpha, abs_dR);  // vpmulhuw
        abs_dG = _mm256_mulhi_epu16(Alpha, abs_dG);  // vpmulhuw
        abs_dB = _mm256_mulhi_epu16(Alpha, abs_dB);  // vpmulhuw
        abs_dW = _mm256_mulhi_epu16(Alpha, abs_dW);  // vpmulhuw

#ifdef DEBUG_BITMAP
        printf("after *Alpha dR=%s\n", util::to_string(abs_dR).c_str());
#endif

        // Apply back the sign.
        dR = _mm256_sign_epi16(abs_dR, dR);  // vpsignw
        dG = _mm256_sign_epi16(abs_dG, dG);  // vpsignw
        dB = _mm256_sign_epi16(abs_dB, dB);  // vpsignw
        dW = abs_dW;

#ifdef DEBUG_BITMAP
        printf("after sign dR=%s\n", util::to_string(dR).c_str());
#endif

        // Add back the difference.
        __m256i R1 = _mm256_add_epi16(R0, dR);  // vpaddw
        __m256i G1 = _mm256_add_epi16(G0, dG);  // vpaddw
        __m256i B1 = _mm256_add_epi16(B0, dB);  // vpaddw
        __m256i W1 = _mm256_add_epi16(W0, dW);  // vpaddw

#ifdef DEBUG_BITMAP
        printf("R1=%s\n", util::to_string(dR).c_str());
#endif

        // Shuffle back to 8-bit values.
        const __m256i idxs = _mm256_set_epi32(
            0x00000000, 0x00000000, 0x0e0c0a08, 0x06040200,
            0x00000000, 0x00000000, 0x0e0c0a08, 0x06040200);
        R1 = _mm256_shuffle_epi8(R1, idxs);  // vpshufb
        G1 = _mm256_shuffle_epi8(G1, idxs);  // vpshufb
        B1 = _mm256_shuffle_epi8(B1, idxs);  // vpshufb
        W1 = _mm256_shuffle_epi8(W1, idxs);  // vpshufb

        // R1[0:63, 128:191] -> R1[0:63, 64:127], etc.
        R1 = _mm256_permute4x64_epi64(R1, 0x08);  // vpermq
        G1 = _mm256_permute4x64_epi64(G1, 0x08);  // vpermq
        B1 = _mm256_permute4x64_epi64(B1, 0x08);  // vpermq
        W1 = _mm256_permute4x64_epi64(W1, 0x08);  // vpermq

        buf[offset * 4] = _mm256_castsi256_si128(R1);
        buf[offset * 4 + 1] = _mm256_castsi256_si128(G1);
        buf[offset * 4 + 2] = _mm256_castsi256_si128(B1);
        buf[offset * 4 + 3] = _mm256_castsi256_si128(W1);
    }

    // Clear the blocklist for `gray_buf`.
    gray_buf->blk_cnt = 0;
}

// Largely copied from RgbBuffer::make_png_data().
std::unique_ptr<UniqueMessageData>
RgbaBuffer::make_png_data(const std::string &name) const
{
    // Same as RgbBuffer, except that each pixel is now 4 bytes (RGBA).
    auto msg = std::make_unique<UniqueMessageData>(name, (256 * 4 + 1) * 256);

    alignas(16) char line_buf[8 * 256];
    memset(line_buf, 0, sizeof(line_buf));

    char *dest = (char *) (msg->get());
    for (int row = 0; row < 256; row++) {
        *(dest++) = (row == 0) ? 0 : 2;

        char *this_line = line_buf + ((row % 2) ? 4 * 256 : 0);
        char *prev_line = line_buf + ((row % 2) ? 0 : 4 * 256);

        // Read the current row from blocks, and re-arrange them into four
        // lines (one each for R, G, B, W).
        char *line_ptr = this_line;
        char *src = (char *) buf + (64 * 16 * 4 * (row / 4)) + (4 * (row % 4));
        for (int i = 0; i < 256 / 4; i++) {
            memcpy(line_ptr, src, 4);  // R
            memcpy(line_ptr + 256, src + 16, 4);  // G
            memcpy(line_ptr + 512, src + 32, 4);  // B
            memcpy(line_ptr + 768, src + 48, 4);  // A
            line_ptr += 4;
            src += 64;
        }

        // Convert RGBW to RGBA.
        line_ptr = this_line;
        const __m256 mult = _mm256_set1_ps(255 * 256.f);
        for (int i = 0; i < 256 / 16; i++) {
            __m128i R, G, B, W;
            memcpy(&R, line_ptr, 16);
            memcpy(&G, line_ptr + 256, 16);
            memcpy(&B, line_ptr + 512, 16);
            memcpy(&W, line_ptr + 768, 16);

            // Force nonzero to avoid division by zero.
            __m128i W1 = _mm_max_epu8(W, _mm_set1_epi8(0x01));  // vpmaxub
            __m128i W1H = _mm_bsrli_si128(W1, 8);  // vpsrldq

            // (vpmovzxbd, vcvtdq2ps) x2
            __m256 WL = _mm256_cvtepi32_ps(_mm256_cvtepu8_epi32(W1));
            __m256 WH = _mm256_cvtepi32_ps(_mm256_cvtepu8_epi32(W1H));

            __m256 WL_reci = _mm256_rcp_ps(WL);  // vrcpps
            __m256 WH_reci = _mm256_rcp_ps(WH);  // vrcpps

            __m256 WL_mult = _mm256_mul_ps(WL_reci, mult);  // vmulps
            __m256 WH_mult = _mm256_mul_ps(WH_reci, mult);  // vmulps

            // NOTE: The rounding mode of vcvtps2dq depends on the MXCSR
            // register - see the discussion on bitmap_buffer.cc.
            __m256i WL_mult1 = _mm256_cvtps_epi32(WL_mult);  // vcvtps2dq
            __m256i WH_mult1 = _mm256_cvtps_epi32(WH_mult);  // vcvtps2dq
            __m256i W_mult = _mm256_packs_epi32(WL_mult1, WH_mult1);  // vpackusdw
            W_mult = _mm256_permute4x64_epi64(W_mult, 0xd8);  // vpermq

            __m256i R1 = _mm256_cvtepu8_epi16(R);  // vpmovzxbw
            __m256i G1 = _mm256_cvtepu8_epi16(G);  // vpmovzxbw
            __m256i B1 = _mm256_cvtepu8_epi16(B);  // vpmovzxbw

            R1 = _mm256_mullo_epi16(W_mult, R1);  // vpmullw
            G1 = _mm256_mullo_epi16(W_mult, G1);  // vpmullw
            B1 = _mm256_mullo_epi16(W_mult, B1);  // vpmullw

            // Shuffle back to 8-bit values.
            const __m256i idxs = _mm256_set_epi32(
                0x00000000, 0x00000000, 0x0f0d0b09, 0x07050301,
                0x00000000, 0x00000000, 0x0f0d0b09, 0x07050301);
            R1 = _mm256_shuffle_epi8(R1, idxs);  // vpshufb
            G1 = _mm256_shuffle_epi8(G1, idxs);  // vpshufb
            B1 = _mm256_shuffle_epi8(B1, idxs);  // vpshufb

            // R1[0:63, 128:191] -> R1[0:63, 64:127], etc.
            R1 = _mm256_permute4x64_epi64(R1, 0x08);  // vpermq
            G1 = _mm256_permute4x64_epi64(G1, 0x08);  // vpermq
            B1 = _mm256_permute4x64_epi64(B1, 0x08);  // vpermq

            memcpy(line_ptr, &R1, 16);
            memcpy(line_ptr + 256, &G1, 16);
            memcpy(line_ptr + 512, &B1, 16);

            line_ptr += 16;
        }

        // Compute the difference from the previous line and emit to `msg`.
        // TODO: Not sure why but clang can't vectorize this?
        //       (Clang does vectorize the same loop in RgbBuffer ...)
        line_ptr = this_line;
        char *prev_ptr = prev_line;
        for (int i = 0; i < 256; i++) {
            // Emitting R, G, B, A.
            *(dest++) = ((uint8_t) line_ptr[0]) - ((uint8_t) prev_ptr[0]);
            *(dest++) = ((uint8_t) line_ptr[256]) - ((uint8_t) prev_ptr[256]);
            *(dest++) = ((uint8_t) line_ptr[512]) - ((uint8_t) prev_ptr[512]);
            *(dest++) = ((uint8_t) line_ptr[768]) - ((uint8_t) prev_ptr[768]);

            line_ptr++;
            prev_ptr++;
        }
    }

    return msg;
}

}  // namespace croquis
