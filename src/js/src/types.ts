import { JSONObject } from '@lumino/coreutils';

// `BufList` is an optional list of binary buffers.
export type BufList = (ArrayBuffer | ArrayBufferView)[];
export type Callback = (msg: JSONObject, attachments: BufList) => void;
