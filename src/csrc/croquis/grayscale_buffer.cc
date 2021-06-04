// A buffer in 256-color grayscle for drawing lines.

#include "croquis/grayscale_buffer.h"

#include <assert.h>
#include <math.h>  // sqrtf
#include <stdint.h>  // uint64_t
#include <stdio.h>  // printf (for debugging)
#include <string.h>  // memcpy

#include <immintrin.h>

#include "croquis/util/avx_util.h"

// #define DEBUG_BITMAP

namespace croquis {

namespace {
struct ColorBlock {
    __m256i blk0, blk1;
};
}  // namespace

// Shuffle map for transforming xy-coordinates to uv-coordinates.
static const uint32_t FLIP = INT32_MIN;
alignas(16) static constexpr uint32_t coord_shuffle_map[] = {
    // Gentle slope: no transpose.
    //      u0  u1      v0      v1
    //      ----------------------
    //  0   x0  x1      y0      y1      No flip
    //  1   x1  x0  255-y1  255-y0      Swap and flip y (x0 > x1)
    //  2   x0  x1  255-y0  255-y1      Flip y (y0 > y1)
    //  3   x1  x0      y1      y0      Swap (x0, y0) and (x1, y1)
    0, 1, 2, 3,
    1, 0, FLIP+3, FLIP+2,
    0, 1, FLIP+2, FLIP+3,
    1, 0, 3, 2,

    // Steep slope: transpose x and y.
    //      u0  u1      v0      v1
    //      ----------------------
    //  4   y0  y1      x0      x1      No flip
    //  5   y0  y1  255-x0  255-x1      Flip v (=x) (x0 > x1)
    //  6   y1  y0  255-x1  255-x0      Swap and flip v (=x) (y0 > y1)
    //  7   y1  y0      x1      x0      Swap (x0, y0) and (x1, y1)
    2, 3, 0, 1,
    2, 3, FLIP+0, FLIP+1,
    3, 2, FLIP+1, FLIP+0,
    3, 2, 1, 0,
};

// Shuffle map for pixels.
// Original arrangement (each 32-bit section has shape (1, 4) in uv-space):
//      v #3  #7  #11 #15
//      ▲ #2  #6  #10 #14
//      | #1  #5  #9  #13
//      | #0  #4  #8  #12
//       ---------------▶ u
//
// After shuffling:
//      y #12 #13 #14 #15
//      ▲ #8  #9  #10 #11
//      | #4  #5  #6  #7
//      | #0  #1  #2  #3
//       ---------------▶ x
alignas(16) static constexpr uint32_t pixel_shuffle_map[] = {
    0x0c080400, 0x0d090501, 0x0e0a0602, 0x0f0b0703,
    0x0f0b0703, 0x0e0a0602, 0x0d090501, 0x0c080400,
    0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c,
    0x00010203, 0x04050607, 0x08090a0b, 0x0c0d0e0f,
};

// Shuffle map for the v-coordinate mask.
// Original arrangement:
//      v #12 = #13 = #14 = #15
//      ▲ #8  = #9  = #10 = #11
//      | #4  = #5  = #6  = #7
//      | #0  = #1  = #2  = #3
//       ---------------------▶ u
//
// After shuffling:
//      y #12 #13 #14 #15
//      ▲ #8  #9  #10 #11
//      | #4  #5  #6  #7
//      | #0  #1  #2  #3
//       ---------------▶ x
alignas(16) static constexpr uint32_t vmask_shuffle_map[] = {
    0x00000000, 0x04040404, 0x08080808, 0x0c0c0c0c,
    0x0c0c0c0c, 0x08080808, 0x04040404, 0x00000000,
    0x0c080400, 0x0c080400, 0x0c080400, 0x0c080400,
    0x0004080c, 0x0004080c, 0x0004080c, 0x0004080c,
};

// Helper function to compute the "color" of 8x4 pixels from the given eight
// "relative" y coordinates, which can represent either the lower or the higher
// boundary line.
//
// A pixel is painted white (0xff) if it's entirely above the line, black (0x00)
// if it's entirely below the line, and the proportion of the area *above* the
// line, if the line passes through the pixel.  (We assume that y value is
// shifted by 0.5 - equivalently, pixel #0 spans y value of [0.0, 1.0].)
//
// For example, if y value is 1.6, then the returned pixels for that column is:
// [0x00 0x66 0xff 0xff] (where 0x66 = 102 = 0.4 * 255).
//
// For efficiency(?), we actually compute *two* blocks, 8x4 each, so that we
// compute a whole 8x8 area per one function call.
//
// NOTE: This algorithm is an approximation.  Computing the exact color (i.e.,
// the exact area under the given line) requires computing a quadratic formula
// (because it can be a triangle), and a line can actually pass through multiple
// pixels with the same x value.
static inline ColorBlock compute_color(__m256 yrel)
{
    const __m256i all_ones = _mm256_set1_epi8(0xff);
    ColorBlock retval;

    __m256 yfloor = _mm256_floor_ps(yrel);  // vroundps
    __m256i yint = _mm256_cvtps_epi32(yfloor);  // vcvtps2dq
    __m256 yfrac = _mm256_sub_ps(yrel, yfloor);  // vsubps

    // Here, `color` is [0, 255], and signifies the proportion of area *under*
    // the line in the pixel that the line passes through.
    __m256i color = _mm256_cvtps_epi32(  // vcvtps2dq
        _mm256_mul_ps(yfrac, _mm256_set1_ps(255.f)));  // vmulps

    // Flip bits: color (0, 1, ..., 255) becomes (-1, -2, ..., -256).
    color = _mm256_andnot_si256(color, all_ones);  // vpandn

    // Shift each entry in `color` by k bytes, where k is the value of
    // `yint`.
    //
    // NOTE: vpsllvd conveniently zeros out all bits if coordinate is not
    //       between [0, 32).
    __m256i shift0 = _mm256_slli_epi32(yint, 3);  // vpslld: multiply by 8.
    __m256i color0 = _mm256_sllv_epi32(color, shift0);  // vpsllvd

    // If yint is negative, then the line is below the lowest pixel: fill
    // the pixels with 0xff.
    __m256i is_neg0 =
        _mm256_cmpgt_epi32(_mm256_setzero_si256(), yint);  // vpcmpgtd
    retval.blk0 = _mm256_or_si256(color0, is_neg0);  // vpor

    // Same for the higher block (y is higher by 4).
    __m256i shift1 = _mm256_sub_epi32(shift0, _mm256_set1_epi32(32));
    __m256i color1 = _mm256_sllv_epi32(color, shift1);  // vpsllvd
    __m256i is_neg1 =
        _mm256_cmpgt_epi32(_mm256_set1_epi32(4), yint);  // vpcmpgtd
    retval.blk1 = _mm256_or_si256(color1, is_neg1);  // vpor

    return retval;
}

// Compute the blcok index back from ublk, vblk and current coordinate type.
// ublk2 == ublk *2, vblk2 == blk * 2.
// See draw_line() for what `shuffle_type` means.
static inline int get_blk_idx(int ublk2, int vblk2, int shuffle_type)
{
    int ushift = (shuffle_type & 0x02) ? 6 : 0;
    int vshift = (shuffle_type & 0x02) ? 0 : 6;

    // mask[0, 1, 2, 3] = (0x0000, 0x0fc0, 0x0000, 0x003f)
    const static int mask[4] = { 0x0000, 0xfc0, 0x0000, 0x003f };
    return ((ublk2 << ushift) + (vblk2 << vshift)) ^ mask[shuffle_type];
}

// Read a 4x4 block (16 bytes) at buf[offset], apply max, and store it back.  If
// the block transitions from zero to nonzero, also record the offset to
// `blklist`.
inline void GrayscaleBuffer::store_blk(int offset, __m128i blk)
{
    __m128i orig = buf[offset];  // vmovdqa
    buf[offset] = _mm_max_epu8(blk, orig);  // vpmaxub, vmovdqa

    // Check if the block transitioned from zero to nonzero, and if so, append
    // to `blklist`.
    bool changed =
        _mm_testz_si128(orig, orig) & ~_mm_testz_si128(blk, blk);  // vptest

    blklist[blk_cnt] = offset;
    blk_cnt += changed;
}

void GrayscaleBuffer::draw_line(float x0, float y0, float x1, float y1,
                                float width)
{
    const float dx = x1 - x0;
    const float dy = y1 - y0;

#ifdef DEBUG_BITMAP
    printf("x0 y0 x1 y1 = %.2f %.2f %.2f %.2f\n", x0, y0, x1, y1);
#endif

    // Store the floating values in the xmm register, and permute/flip the
    // coordinates so that the slope is in range [0.0, 1.0].
    __m128 coords = _mm_set_ps(y1, y0, x1, x0);
    int coord_type =
        4 * (fabsf(dy) > fabsf(dx)) +  // bit 2: steep slope
        2 * (y0 > y1) +                // bit 1: y0 > y1
        1 * (x0 > x1);                 // bit 0: x0 > x1

    __m128i perm = ((const __m128i *) coord_shuffle_map)[coord_type];
    coords = _mm_permutevar_ps(coords, perm);  // vpermilps
    __m128 flipped = _mm_sub_ps(_mm_set1_ps(255.0f), coords);  // vsubps
    coords =
        _mm_blendv_ps(coords, flipped, _mm_castsi128_ps(perm));  // vblendps

    // Probably inefficient, but let's keep it simple for now.
    float val[4];
    memcpy((void *) val, (void *) &coords, 16);
    const float u0 = val[0];
    const float u1 = val[1];
    const float v0 = val[2];
    const float v1 = val[3];
    const float du = u1 - u0;
    const float dv = v1 - v0;

    // (0, 1, 2, 3, 4, 5, 6, 7) -> (0, 1, 1, 0, 2, 3, 3, 2)
    //  0: no transformation          (u = x, v = y)
    //  1: flip y                     (u = x, v = 255 - y)
    //  2: transpose                  (u = y, v = x)
    //  3: flip x, and then transpose (u = y, v = 255 - x)
    int shuffle_type = (coord_type >> 1) ^ (coord_type & 0x01);

    // Now we draw line in the uv-space, where the slope is in [0.0, 1.0].
    //
    // invlen: 1.0 / (length of the line).
    // wu, wv: half-width lateral displacement of the line in u/v directions.
    //
    // Lower Edge:  from (u0 + wu, v0 - wv) to (u1 + wu, v1 - wv)
    // Higher Edge: from (u0 - wu, v0 + wv) to (u1 - wu, v1 + wv)
    __m128 duv = _mm_hsub_ps(coords, coords);  // vhsubps: [-du, -dv, -du, -dv]
    __m128 len2 = _mm_mul_ps(duv, duv);  // vmulps: [du * du, dv * dv, ...]
    len2 = _mm_hadd_ps(len2, len2);  // vhaddps: [du * du + dv * dv, ...]
    const float invlen = _mm_cvtss_f32(_mm_rsqrt_ss(len2));  // vrsqrtss
    const float wu = dv * (invlen * width / 2);
    const float wv = du * (invlen * width / 2);

    // Compute the bounding box: we only touch pixels inside this box.
    // (This is easier and hopefully faster than correctly drawing the short
    // edge at either end of the line - the ends will be overpainted by markers
    // with the same size as the line width, so it does not matter.)
    __m128 boxf =
        _mm_addsub_ps(coords, _mm_set_ps(wv, wv, wu, wu));  // vaddsubps
    __m128i box = _mm_cvtps_epi32(boxf);  // vcvtps2dq

// Doesn't seem to matter ...
#if 0
    // Since we only draw [0, 255], we can downconvert to shorts.
    box = _mm_packs_epi32(box, box);  // vpackssdw
#endif

    const int umin = _mm_extract_epi32(box, 0);
    const int umax = _mm_extract_epi32(box, 1);
    const int vmin = _mm_extract_epi32(box, 2);
    const int vmax = _mm_extract_epi32(box, 3);

    // Compute the slope and the v-intercept of lower/higher lines.
    // We add 0.5 to make computation easier: e.g., if the lower line is "going
    // through" pixel (0, 40), then its v value must be between 39.5 and 40.5,
    // which translates to vL0 between 40 and 41.
    const float slope = dv / du;
    float vL0 = (v0 - wv) - slope * (u0 + wu) + .5f;
    float vH0 = (v0 + wv) - slope * (u0 - wu) + .5f;

#ifdef DEBUG_BITMAP
    printf("  u0 v0 u1 v1 = %.3f %.3f %.3f %.3f\n", u0, v0, u1, v1);
    printf("  coord_type = %d shuffle_type = %d\n", coord_type, shuffle_type);
    printf("  invlen wu wv = %g %.4f %.4f\n", invlen, wu, wv);
    printf("  umin umax vmin vmax = %d %d %d %d\n", umin, umax, vmin, vmax);
    printf("  slope = %.3f vL0 = %.3f vH0 = %.3f\n", slope, vL0, vH0);
#endif

    // Find the coordinate of the first 8x8 block to process.
    int ublk, vblk;
    if (umin >= 0 && vmin >= 0) {
        // If (umin, vmin) is inside the drawing area, we can start from there.
        ublk = umin / 8;
        vblk = vmin / 8;
    }
    else {
        // The line starts outside the drawing area.
        if (vH0 >= 0) {
            // If vH0 >= 0, then the higher line passes above (0, 0).  Hence, the
            // left-bottom corner can start at (0, vL0).
            ublk = 0;
            vblk = floorf(vL0) / 8;
            if (vblk < 0) vblk = 0;
        }
        else {
            // If the higher line passes below (0, 0), then find the
            // u-coordinate when v equals -0.5 (i.e., when it enters a pixel in
            // the bottom row).  To guard against overflow, let's first check if
            // the pixel is to the right of the drawing area, in which case
            // there's nothing to draw.
            if (slope * (256 + 1 - (u0 - wu)) < -0.5f - (v0 + wv)) return;
            const float uH = (u0 - wu) + (-0.5f - (v0 + wv)) / slope;
            ublk = nearbyintf(uH) / 8;
            vblk = 0;
        }
    }

    if (ublk >= (256 / 8) || vblk >= (256 / 8)) return;

    // vcvtps2dq returns INT_MIN (0x80000000) for overflow, so low values for
    // yL/yH are okay, but values higher than INT_MAX will result in sign flip.
    // I think it's very unlikely (it will require a very high zoom level), but
    // let's guard against it, just in case.
    if (vL0 > 256 + 1) return;
    vH0 = fminf(vH0, 256 + 1);

    // In each successive eight columns:
    //      vL + 0.5 = (leftmost u * slope) + vL_disps
    //      vH + 0.5 = (leftmost u * slope) + vH_disps
    const __m256 steps = _mm256_set_ps(7.f, 6.f, 5.f, 4.f, 3.f, 2.f, 1.f, 0.f);
    const __m256 vL_disps = _mm256_fmadd_ps(  // vfmadd...ps
        steps, _mm256_set1_ps(slope), _mm256_set1_ps(vL0));
    const __m256 vH_disps = _mm256_fmadd_ps(  // vfmadd...ps
        steps, _mm256_set1_ps(slope), _mm256_set1_ps(vH0));

    // Used to compute bitmasks for allowed u & v ranges (umin--umax,
    // vmin--vmax).
    __m256i uthreshold = _mm256_set1_epi32(umax - umin - 0x80000000U + 1);
    __m256i vthreshold = _mm256_set1_epi32(vmax - vmin - 0x80000000U + 1);

    int down_cnt = 0;

#ifdef DEBUG_BITMAP
    printf("  ublk = %d vblk = %d\n", ublk, vblk);
#endif

    while (true) {
        const __m256i zeros = _mm256_setzero_si256();
        const __m256i all_ones = _mm256_set1_epi8(0xff);
        const __m256i isteps = _mm256_set_epi32(7, 6, 5, 4, 3, 2, 1, 0);

        // Compute displacement relative to (ublk * 8, vblk * 8).
        const float vrel = (ublk * 8) * slope - (vblk * 8);
        const __m256 vL_rel =
            _mm256_add_ps(_mm256_set1_ps(vrel), vL_disps);  // vaddps
        const __m256 vH_rel =
            _mm256_add_ps(_mm256_set1_ps(vrel), vH_disps);  // vaddps

        ColorBlock colorL = compute_color(vL_rel);
        ColorBlock colorH = compute_color(vH_rel);

        // Subtract the "colors" so that we get the correct area *between* lower
        // and higher lines for each pixel.
        ColorBlock colors;
        colors.blk0 = _mm256_sub_epi8(colorL.blk0, colorH.blk0);
        colors.blk1 = _mm256_sub_epi8(colorL.blk1, colorH.blk1);

        // Apply bitmask for allowed u range (umin--umax).
        // We shift coordinate so that `umin` becomes INT_MIN, so
        // (ucoords < INT_MIN + umax - umin + 1) iff u is in [umin, umax].
        int ucoord = ublk * 8 - umin - 0x80000000;
        __m256i ucoords =
            _mm256_add_epi32(_mm256_set1_epi32(ucoord), isteps);  // vpaddd
        __m256i umask = _mm256_cmpgt_epi32(uthreshold, ucoords);  // vpcmpgtd
        colors.blk0 = _mm256_and_si256(colors.blk0, umask);  // vpand
        colors.blk1 = _mm256_and_si256(colors.blk1, umask);  // vpand

#ifdef DEBUG_BITMAP
        printf("ublk vblk = %d %d : u v = %d %d\n",
               ublk, vblk, ublk * 8, vblk * 8);
        printf("  vL, vH at start: %.2f %.2f\n",
               vL0 + slope * ublk * 8, vH0 + slope * ublk * 8);
        printf("  ucoords = %s\n", util::to_string(ucoords).c_str());
        printf("  umask = %s\n", util::to_string(umask).c_str());
        printf("  colors.blk0 = %s\n", util::to_string(colors.blk0).c_str());
        printf("  colors.blk1 = %s\n", util::to_string(colors.blk1).c_str());
        printf("  colorL.blk0 = %s\n", util::to_string(colorL.blk0).c_str());
        printf("  colorL.blk1 = %s\n", util::to_string(colorL.blk1).c_str());
        printf("  colorH.blk0 = %s\n", util::to_string(colorH.blk0).c_str());
        printf("  colorH.blk1 = %s\n", util::to_string(colorH.blk1).c_str());
#endif

        // Compute the bitmask for allowed v range (vmin--vmax).
        int vcoord = vblk * 8 - vmin - 0x80000000;
        __m256i vcoords =
            _mm256_add_epi32(_mm256_set1_epi32(vcoord), isteps);  // vpaddd
        __m256i vmask = _mm256_cmpgt_epi32(vthreshold, vcoords);  // vpcmpgtd

        // Now shuffle `colors` into the correct coordinate (xy-space) so that
        // we can write them into the buffer.
        const __m128i *pptr =
            &((const __m128i *) pixel_shuffle_map)[shuffle_type];
        __m256i c_idxs = _mm256_broadcastsi128_si256(*pptr);  // vbroadcasti128
        colors.blk0 = _mm256_shuffle_epi8(colors.blk0, c_idxs);  // vpshufb
        colors.blk1 = _mm256_shuffle_epi8(colors.blk1, c_idxs);  // vpshufb

        // Ditto for v masks.
        pptr = &((const __m128i *) vmask_shuffle_map)[shuffle_type];
        __m256i v_idxs = _mm256_broadcastsi128_si256(*pptr);  // vbroadcasti128
        vmask = _mm256_shuffle_epi8(vmask, v_idxs);  // vpshufb
        __m256i vmask0 =
            _mm256_permute2x128_si256(vmask, vmask, 0x00);  // vperm2i128
        __m256i vmask1 =
            _mm256_permute2x128_si256(vmask, vmask, 0x11);  // vperm2i128

        // Apply the bitmask for allowed v range.
        colors.blk0 = _mm256_and_si256(colors.blk0, vmask0);  // vpand
        colors.blk1 = _mm256_and_si256(colors.blk1, vmask1);  // vpand

        // Now store the blocks.
        store_blk(get_blk_idx(ublk * 2, vblk * 2, shuffle_type),
                  _mm256_castsi256_si128(colors.blk0));
        store_blk(get_blk_idx(ublk * 2 + 1, vblk * 2, shuffle_type),
                  _mm256_extracti128_si256(colors.blk0, 1));  // vextracti128
        store_blk(get_blk_idx(ublk * 2, vblk * 2 + 1, shuffle_type),
                  _mm256_castsi256_si128(colors.blk1));
        store_blk(get_blk_idx(ublk * 2 + 1, vblk * 2 + 1, shuffle_type),
                  _mm256_extracti128_si256(colors.blk1, 1));  // vextracti128

        // Check the highest byte (i.e., top right pixel).
        // (1) If the lower line passes below the pixel (i.e., highest byte of
        //     `colorL` > 0), then we have to process the block to the right
        //     later.
        __m256i is_zero = _mm256_cmpeq_epi8(colorL.blk1, zeros);  // vpcmpeqb
        int check_right = (_mm256_movemask_epi8(is_zero) >= 0);  // vpmovmskb

        // (2) If the higher line passes above the pixel (i.e., highest byte of
        //     `colorH` < 255), then we have to move up.
        __m256i is_max = _mm256_cmpeq_epi8(colorH.blk1, all_ones);  // vpcmpeqb
        int up = (_mm256_movemask_epi8(is_max) >= 0);  // vpmovmskb
        up &= (vblk < (256 / 8) - 1);

#ifdef DEBUG_BITMAP
        printf("check_right = %d up = %d\n", check_right, up);
#endif

        // If both `check_right` and `up` is true, then increment `down_cnt` so
        // that we can find the correct staring point after moving right later.
        //
        // For example, if we move like this:
        //
        //      (3, 4)       ...
        //        ^   \       ^
        //      (3, 3) \    (4, 3)
        //        ^     \     ^
        //      (3, 2)   -->(4, 2)
        //        ^
        //      (3, 1)
        //
        // Then:
        //      (3, 1) : up
        //      (3, 2) : up, check_right -> increment down_cnt
        //      (3, 3) : up, check_right -> increment down_cnt
        //      (3, 4) :     check_right -> apply and clear down_cnt
        //      (4, 2) ...
        down_cnt += (check_right & up);

        ublk += !up;
        int vincr = up ? 1 : -down_cnt;
        vblk += vincr;

        down_cnt &= -up;  // "if (!up) down_cnt = 0;"

        if (ublk >= (256 / 8) || (ublk * 8) > umax) return;
    }
}

// Hopefully this can be made faster, but for now let's use brute force.  It
// should be OK for small circles.
void GrayscaleBuffer::draw_circle(float x0, float y0, float radius)
{
    // To simplify computation, we first compute the distance D from each pixel
    // to the center, and compare D & r to decide color:
    //      * D < r - 0.5 : pixel is fully colored.
    //      * D == r      : pixel is exactly half colored.
    //      * D > r - 0.5 : pixel is not colored.
    //
    // To further simplify, we simply compute D^2, and use linear approximation
    // (i.e., d(r^2)/dr = 2r), so the above becomes:
    //      * D^2 < r^2 - r : pixel is fully colored.
    //      * D^2 == r^2    : pixel is exactly half colored.
    //      * D^2 > r^2 + r : pixel is not colored.
    //
    // So, (color) = ((r^2 + r) - D^2) * (255 / 2r)
    //             = -D^2 * (255 / 2r) + (255 * (r + 1) / 2).
    __m256 A = _mm256_set1_ps(-255.f / 2.f / radius);
    __m256 B = _mm256_set1_ps(255.f / 2.f * (radius + 1.f));

    // Find start/end blocks: each block is 4x4 pixels.
    //      xblk0 = floorf((x0 + 0.5f - radius) / 4);
    //      xblk1 = floorf((x0 + 0.5f + radius) / 4);
    //      yblk0 = floorf((y0 + 0.5f - radius) / 4);
    //      yblk1 = floorf((y0 + 0.5f + radius) / 4);
    __m128 coords = _mm_set_ps(y0, y0, x0, x0);
    coords = _mm_add_ps(coords, _mm_set1_ps(0.5f));
    coords = _mm_addsub_ps(coords, _mm_set1_ps(radius));
    coords = _mm_mul_ps(coords, _mm_set1_ps(0.25f));
    coords = _mm_floor_ps(coords);  // vroundps
    __m128i coords_int = _mm_cvtps_epi32(coords);  // vcvtps2dq

    int buf[4];
    memcpy(buf, &coords_int, sizeof(coords_int));
    int xblk0 = (buf[0] < 0) ? 0 : buf[0];
    int xblk1 = (buf[1] > 63) ? 63 : buf[1];
    int yblk0 = (buf[2] < 0) ? 0 : buf[2];
    int yblk1 = (buf[3] > 63) ? 63 : buf[3];

    // We process each 4x4 block by dividing it into two 4x2 blocks.
    // Block #0 contains rows #0 and #2, and block #1 contains rows #1 and #3.
    // (This looks weird, but then we can merge them correctly with
    // _mm256_packs_epi32.
    const __m256 xsteps = _mm256_set_ps(3.f, 2.f, 1.f, 0.f, 3.f, 2.f, 1.f, 0.f);
    const __m256 xdists0 =
        _mm256_add_ps(_mm256_set1_ps(xblk0 * 4 - x0), xsteps);

    const __m256 ysteps = _mm256_set_ps(2.f, 2.f, 2.f, 2.f, 0.f, 0.f, 0.f, 0.f);
    __m256 ydistsL = _mm256_add_ps(_mm256_set1_ps(yblk0 * 4 - y0), ysteps);
    __m256 ydistsH = _mm256_add_ps(ydistsL, _mm256_set1_ps(1.f));

    for (int yblk = yblk0; yblk <= yblk1; yblk++) {
        __m256 xdists = xdists0;
        __m256 ydistsL2 = _mm256_mul_ps(ydistsL, ydistsL);
        __m256 ydistsH2 = _mm256_mul_ps(ydistsH, ydistsH);

        for (int xblk = xblk0; xblk <= xblk1; xblk++) {
            __m256 xdists2 = _mm256_mul_ps(xdists, xdists);

            __m256 distsL2 = _mm256_add_ps(xdists2, ydistsL2);
            __m256 distsH2 = _mm256_add_ps(xdists2, ydistsH2);

            __m256 colorL = _mm256_fmadd_ps(distsL2, A, B);
            __m256 colorH = _mm256_fmadd_ps(distsH2, A, B);

            __m256i colorL_int = _mm256_cvtps_epi32(colorL);  // vcvtps2dq
            __m256i colorH_int = _mm256_cvtps_epi32(colorH);  // vcvtps2dq

            // First convert to int16_t with saturation.
            // `color_int` contains 16 values in this order:
            //      colorL_int[0, 1, 2, 3]
            //      colorH_int[0, 1, 2, 3]
            //      colorL_int[4, 5, 6, 7]
            //      colorH_int[4, 5, 6, 7]
            __m256i color_short = _mm256_packs_epi32(colorL_int, colorH_int);
                // vpackssdw

            // Now convert to uint8_t with saturation.
            __m128i colorL_short = _mm256_castsi256_si128(color_short);
            __m128i colorH_short = _mm256_extractf128_si256(color_short, 1);
                // vextractf128
            __m128i color = _mm_packus_epi16(colorL_short, colorH_short);
                // packuswb

            store_blk(get_blk_idx(xblk, yblk, 0), color);

            // Update `xdists`.
            xdists = _mm256_add_ps(xdists, _mm256_set1_ps(4.f));
        }

        ydistsL = _mm256_add_ps(ydistsL, _mm256_set1_ps(4.f));
        ydistsH = _mm256_add_ps(ydistsH, _mm256_set1_ps(4.f));
    }
}

} // namespace croquis
