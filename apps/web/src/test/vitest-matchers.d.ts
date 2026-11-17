import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// jest-dom 6 的类型声明仍按 Vitest 2 的单泛型 Assertion 写；
// Vitest 5 的 Assertion 是 <R, T>，直接合并不生效，这里按实际泛型重声明。
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 声明合并必须用 interface
  interface Assertion<R = void, T = unknown> extends TestingLibraryMatchers<T, R> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 声明合并必须用 interface
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
