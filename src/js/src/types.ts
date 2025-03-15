// `BufList` is an optional list of binary buffers.
export type AnyJson = Record<string, any>;
export type BufList = (ArrayBuffer | ArrayBufferView)[];
export type Callback = (msg: Record<string, any>, attachments: BufList) => void;
