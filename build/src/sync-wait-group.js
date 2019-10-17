"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class WaitGroup {
    constructor() {
        this.counter = 0;
        this.waitCounter = 0;
        this.waitPendingPromise = null;
        this.waitPendingResolve = null;
        this.finished = false;
    }
    add(delta) {
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
    done() {
        this.add(-1);
    }
    // tslint:disable-next-line: promise-function-async
    wait() {
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
    notify() {
        if (this.waitPendingResolve) {
            const waitPendingResolve = this.waitPendingResolve;
            this.waitPendingResolve = null;
            waitPendingResolve();
        }
    }
}
WaitGroup.RESOLVED_PROMISE = Promise.resolve();
exports.WaitGroup = WaitGroup;
function panic(message) {
    const error = new Error(message);
    process.nextTick(() => {
        throw error;
    });
}
//# sourceMappingURL=sync-wait-group.js.map