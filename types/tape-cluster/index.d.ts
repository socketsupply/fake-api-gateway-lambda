// TypeScript Version: 3.0

type TestCase = import('@pre-bundled/tape').TestCase
type Test = import('@pre-bundled/tape').Test

type tapeClusterTestCase<Harness> =
/* eslint-disable-next-line @typescript-eslint/no-invalid-void-type */
  (harness: Harness, test: Test) => (void | Promise<void>);

interface TapeClusterFn<Options, Harness> {
  (name: string, cb?: tapeClusterTestCase<Harness>): void;
  (
    name: string,
    opts: Options,
    cb: tapeClusterTestCase<Harness>
  ): void;

  only(name: string, cb?: tapeClusterTestCase<Harness>): void;
  only(
    name: string,
    opts: Options,
    cb: tapeClusterTestCase<Harness>
  ): void;

  skip(name: string, cb?: tapeClusterTestCase<Harness>): void;
  skip(
    name: string,
    opts: Options,
    cb: tapeClusterTestCase<Harness>
  ): void;
}

interface TestHarness {
  bootstrap(): Promise<void>;
  close(): Promise<void>;
}

declare namespace tapeCluster {}

declare function tapeCluster<Harness extends TestHarness, Options = {}> (
  tape: ((name: string, cb: TestCase) => void),
  harness: (new (opts?: Options) => Harness)
): TapeClusterFn<Options, Harness>

export = tapeCluster
