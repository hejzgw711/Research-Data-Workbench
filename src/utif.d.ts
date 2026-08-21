declare module 'utif' {
  export interface IFD {
    width: number
    height: number
    data?: Uint8Array | Uint16Array
    t258?: number | number[]
    t262?: number | number[]
  }
  const UTIF: {
    decode(buffer: ArrayBuffer): IFD[]
    decodeImage(buffer: ArrayBuffer, ifd: IFD): void
    toRGBA8(ifd: IFD): Uint8Array
  }
  export default UTIF
}
