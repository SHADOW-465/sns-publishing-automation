declare module 'upng-js' {
  interface Decoded {
    width: number
    height: number
  }
  interface Api {
    decode(b: ArrayBufferLike): Decoded
    toRGBA8(img: Decoded): ArrayBuffer[]
    encode(bufs: ArrayBufferLike[], w: number, h: number, ps: number): ArrayBuffer
  }
  const UPNG: Api
  export default UPNG
}
