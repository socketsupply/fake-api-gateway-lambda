export class WaitGroup {
    private counter: number;
    private waitCounter: number;
    private waitPendingPromise: Promise<void> | null;
    private waitPendingResolve: (() => void) | null;
    private finished: boolean;

    private static readonly RESOLVED_PROMISE: Promise<void> =
        Promise.resolve();

    constructor() {
        this.counter = 0;
        this.waitCounter = 0;
        this.waitPendingPromise = null;
        this.waitPendingResolve = null;
        this.finished = false;
    }

    add(delta: number): void {
        if (this.finished) {
            panic('sync: WaitGroup misuse: WaitGroup is reused');
        }

        this.counter += delta;

        if (this.counter < 0) {
            panic('sync: negative WaitGroup counter');
            return;
        }

        if (this.counter > 0 || this.waitCounter === 0) {
            return;
        }

        this.finished = true;
        this.notify();
    }

    done(): void {
        this.add(-1);
    }

    // tslint:disable-next-line: promise-function-async
    wait(): Promise<void> {
        if (this.counter === 0) {
            return WaitGroup.RESOLVED_PROMISE;
        }

        this.waitCounter++;
        if (this.waitPendingPromise) {
            return this.waitPendingPromise;
        }

        // tslint:disable-next-line: promise-must-complete
        this.waitPendingPromise = new Promise((resolve) => {
            this.waitPendingResolve = resolve;
        });
        return this.waitPendingPromise;
    }

    private notify(): void {
        if (this.waitPendingResolve) {
            const waitPendingResolve = this.waitPendingResolve;
            this.waitPendingResolve = null;
            waitPendingResolve();
        }
    }
}

function panic(message: string): void {
    const error = new Error(message);
    process.nextTick(() => {
        throw error;
    });
}
