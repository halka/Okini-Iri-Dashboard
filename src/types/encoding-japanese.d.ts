declare module "encoding-japanese" {
  type Input = number[] | Uint8Array | Uint16Array | ArrayBuffer | string;

  interface ConvertOptions {
    to: string;
    from?: string | string[];
    type?: "array" | "arraybuffer" | "string";
  }

  interface EncodingJapanese {
    detect(data: Input, encodings?: string | string[]): string | false;
    convert(data: Input, options: ConvertOptions): number[] | Uint8Array | Uint16Array | string;
  }

  const Encoding: EncodingJapanese;
  export default Encoding;
}

