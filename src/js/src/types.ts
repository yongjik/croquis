// `BufList` is an optional list of binary buffers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJson = Record<string, any>;
export type BufList = (ArrayBuffer | ArrayBufferView)[];
export type Callback = (msg: AnyJson, attachments: BufList) => void;

export const UNKNOWN = Symbol("unknwon");
export type Unknown = typeof UNKNOWN
