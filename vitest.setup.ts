import { vi, type Mock as ViMock, type Mocked as ViMocked } from 'vitest';

declare global {
  var jest: typeof vi;

  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    type Mock<TFunction = Function> = TFunction extends (...args: infer TArgs) => infer TReturn
      ? ViMock<(...args: TArgs) => TReturn>
      : ViMock;
    type Mocked<T> = ViMocked<T>;
    type SpyInstance = ReturnType<typeof vi.spyOn>;
  }
}

globalThis.jest = vi;
