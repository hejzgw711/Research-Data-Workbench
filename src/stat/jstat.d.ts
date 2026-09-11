declare module 'jstat' {
  export const jStat: {
    studentt: {
      cdf(value: number, df: number): number
      inv(probability: number, df: number): number
    }
    centralF: { cdf(value: number, df1: number, df2: number): number }
  }
}
