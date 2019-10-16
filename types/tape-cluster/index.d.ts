// TypeScript Version: 3.0

type TestCase = import('tape').TestCase
type Test = import('tape').Test

interface tapeClusterTestCase<Harness> {
  (harness: Harness, test: Test): void;
}

interface tapeClusterFn<Options, Harness> {
  (name: string): void
  (name: string, cb: tapeClusterTestCase<Harness>): void
  (
    name: string,
    opts: Options,
    cb: tapeClusterTestCase<Harness>
  ): void

  only(name: string): void
  only(name: string, cb: tapeClusterTestCase<Harness>): void
  only(
    name: string,
    opts: Options,
    cb: tapeClusterTestCase<Harness>
  ): void

  skip(name: string): void
  skip(name: string, cb: tapeClusterTestCase<Harness>): void
  skip(
    name: string,
    opts: Options,
    cb: tapeClusterTestCase<Harness>
  ): void
}

interface TestHarness {
  bootstrap(): Promise<void>
  close(): Promise<void>
}

declare namespace tapeCluster {}

declare function tapeCluster<Options, Harness extends TestHarness>(
  tape: ((name: string, cb: TestCase) => void),
  harness: (new (opts?: Options) => Harness)
): tapeClusterFn<Options, Harness>

export = tapeCluster
