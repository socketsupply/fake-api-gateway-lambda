'use strict';

/**
 * This is the worker child process that imports the lambda
 * user code.
 *
 * This needs to do a bunch of "simulation" work to make
 * it appear like a real AWS lambda.
 */

interface Dictionary<T> {
    [key: string]: T;
}

interface LambdaResult {
    isBase64Encoded: boolean;
    statusCode: number;
    headers: Dictionary<string>;
    multiValueHeaders: Dictionary<string[]>;
    body: string;
}

interface LambdaFunction {
    (
        event: object,
        ctx: object,
        cb: (err: Error, result?: LambdaResult) => void
    ): Promise<LambdaResult> | void;
}

class LambdaWorker {
    private routes: Dictionary<string> | null;
    private readonly lambdaFunctions: Dictionary<LambdaFunction>;

    constructor() {
        this.routes = null;
        this.lambdaFunctions = {};
    }

    handleMessage(msg: unknown): void {
        if (typeof msg !== 'object' || !msg) {
            bail('bad data type from parent process');
            return;
        }

        const objMsg = <Dictionary<unknown>> msg;
        const messageType = objMsg['message'];
        if (messageType === 'start') {
            const routes = objMsg['routes'];
            if (!isStringDictionary(routes)) {
                bail('bad data type from parent process');
                return;
            }

            this.handleStartMessage(routes);
        } else if (messageType === 'event') {
            const id = objMsg['id'];
            if (typeof id !== 'string') {
                bail('bad data type from parent process');
                return;
            }

            const eventObject = objMsg['eventObject'];
            if (typeof eventObject !== 'object' ||
                eventObject === null
            ) {
                bail('bad data type from parent process');
                return;
            }

            this.handleEventMessage(
                id, <Dictionary<unknown>> eventObject
            );
        } else {
            bail('bad data type from parent process');
        }
    }

    private handleStartMessage(routes: Dictionary<string>): void {
        this.routes = routes;

        for (const key of Object.keys(routes)) {
            this.lambdaFunctions[key] =
                // tslint:disable-next-line: non-literal-require
                <LambdaFunction> require(routes[key]);
        }
    }

    private handleEventMessage(
        id: string,
        eventObject: Dictionary<unknown>
    ): void {
        const path = eventObject['path'];
        if (typeof path !== 'string') {
            bail('bad data type from parent process');
            return;
        }

        if (!this.routes) {
            bail('got event before start msg');
            return;
        }

        const knownRoutes = Object.keys(this.routes);
        for (const route of knownRoutes) {
            if (path.startsWith(route)) {
                this.invokeLambda(
                    id, eventObject, this.lambdaFunctions[route]
                );
                return;
            }
        }

        this.sendResult(id, {
            isBase64Encoded: false,
            statusCode: 404,
            headers: {},
            body: 'Not Found',
            multiValueHeaders: {}
        });
    }

    invokeLambda(
        id: string,
        eventObject: Dictionary<unknown>,
        fn: LambdaFunction
    ): void {
        /**
         * @raynos TODO: We have to populate the lambda eventObject
         * here and we have not done so at all.
         */

         /**
          * @raynos TODO: We have to pretend to be lambda here.
          * We need to set a bunch of global environment variables.
          *
          * There are other lambda emulation modules that have
          * reference examples of how to "pretend" to be lambda
          * that we can borrow implementations from.
          */

        const maybePromise = fn(eventObject, {}, (err, result) => {
            if (!result) {
                this.sendError(id, err);
                return;
            }

            this.sendResult(id, result);
        });

        if (maybePromise) {
            maybePromise.then((result) => {
                this.sendResult(id, result);
            }, (err: Error) => {
                this.sendError(id, err);
            });
        }
    }

    sendError(id: string, err: Error): void {
        /**
         * @raynos TODO: We should identify what AWS lambda does here
         * in co-ordination with AWS API Gateway and return that
         * instead.
         */
        this.sendResult(id, {
            isBase64Encoded: false,
            statusCode: 500,
            headers: {},
            body: 'Unknown server error: ' + err.message,
            multiValueHeaders: {}
        });
    }

    sendResult(id: string, result: LambdaResult): void {
        // tslint:disable-next-line: no-unbound-method
        if (typeof process.send !== 'function') {
            bail('cannot send to parent process');
            return;
        }

        process.send({
            message: 'result',
            id,
            result: {
                isBase64Encoded: result.isBase64Encoded || false,
                statusCode: result.statusCode,
                // tslint:disable-next-line: strict-boolean-expressions
                headers: result.headers || {},
                body: result.body,
                multiValueHeaders: result.multiValueHeaders
            }
        });
    }
}

function isStringDictionary(v: unknown): v is Dictionary<string> {
    if (typeof v !== 'object' || !v) {
        return false;
    }

    const vObj = <Dictionary<unknown>> v;
    for (const key of Object.keys(vObj)) {
        if (typeof vObj[key] !== 'string') {
            return false;
        }
    }
    return true;
}

function main(): void {
    const worker = new LambdaWorker();
    process.on('message', (msg: unknown) => {
        worker.handleMessage(msg);
    });
}

function bail(msg: string): void {
    process.stderr.write(
        'fake-api-gateway-lambda: ' +
        'The lambda process has to exit because: ' +
        msg + '\n',
        () => {
            process.exit(1);
        }
    );
}

main();
