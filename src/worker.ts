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
    multiValueHeaders?: Dictionary<string[]>;
    body: string;
}

interface LambdaFunction {
    handler(
        event: object,
        ctx: object,
        cb: (err: Error, result?: LambdaResult) => void
    ): Promise<LambdaResult> | void;
}

class LambdaWorker {
    private readonly knownRoutes: Dictionary<string>[];
    private routes: Dictionary<string>;
    private readonly lambdaFunctions: Dictionary<LambdaFunction | undefined>;

    constructor() {
        this.knownRoutes = [];
        this.routes = {};
        this.lambdaFunctions = {};
    }

    handleMessage(msg: unknown): void {
        if (typeof msg !== 'object' || !msg) {
            bail('bad data type from parent process: handleMessage');
            return;
        }

        const objMsg = <Dictionary<unknown>> msg;
        const messageType = objMsg['message'];
        // tslint:disable-next-line: prefer-switch
        if (messageType === 'start') {
            const knownRoutes = objMsg['knownRoutes'];
            if (!Array.isArray(knownRoutes)) {
                bail('bad data type from parent process: start');
                return;
            }

            for (const v of knownRoutes) {
                if (!isStringDictionary(v)) {
                    bail('bad data type from parent process: start');
                    return;
                }
            }

            this.handleStartMessage(<Dictionary<string>[]> knownRoutes);
        } else if (messageType === 'event') {
            const id = objMsg['id'];
            if (typeof id !== 'string') {
                bail('bad data type from parent process: event');
                return;
            }

            const eventObject = objMsg['eventObject'];
            if (typeof eventObject !== 'object' ||
                eventObject === null
            ) {
                bail('bad data type from parent process: event');
                return;
            }

            this.handleEventMessage(
                id, <Dictionary<unknown>> eventObject
            );
        } else if (messageType === 'addRoutes') {
            const routes = objMsg['routes'];
            if (!isStringDictionary(routes)) {
                bail('bad data type from parent process: addRoutes');
                return;
            }

            this.addRoutes(routes);
        } else if (messageType === 'removeRoutes') {
            const routes = objMsg['routes'];
            if (!isStringDictionary(routes)) {
                bail('bad data type from parent process: removeRoutes');
                return;
            }

            this.removeRoutes(routes);
        } else {
            console.log('?', objMsg);
            bail('bad data type from parent process: unknown');
        }
    }

    private removeRoutes(routes: Dictionary<string>): void {
        let foundIndex = -1;
        for (let i = 0; i < this.knownRoutes.length; i++) {
            const r = this.knownRoutes[i];
            if (r['__id__'] === routes['__id__']) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            bail('cannot removeRoutes for route that we do not know about');
            return;
        }

        this.knownRoutes.splice(foundIndex, 1);
        this.rebuildRoutes();
    }

    private addRoutes(routes: Dictionary<string>): void {
        this.knownRoutes.push(routes);

        for (const key of Object.keys(routes)) {
            if (key === '__id__') {
                continue;
            }

            const lambdaFile = routes[key];
            const lambdaFn = this.lambdaFunctions[lambdaFile];
            if (!lambdaFn) {
                this.lambdaFunctions[lambdaFile] =
                    // tslint:disable-next-line: non-literal-require
                    <LambdaFunction> require(lambdaFile);
            }
        }

        this.rebuildRoutes();
    }

    private rebuildRoutes(): void {
        /**
         * Copy over route definition with last write wins confict
         * resolution.
         */
        const result: Dictionary<string> = {};

        for (const routes of this.knownRoutes) {
            for (const key of Object.keys(routes)) {
                result[key] = routes[key];
            }
        }

        this.routes = result;
    }

    private handleStartMessage(knownRoutes: Dictionary<string>[]): void {
        for (const routes of knownRoutes) {
            this.addRoutes(routes);
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

        const routePrefixes = Object.keys(this.routes);
        for (const route of routePrefixes) {
            if (path.startsWith(route)) {
                const fnName = this.routes[route];
                const lambda = this.lambdaFunctions[fnName];
                if (!lambda) {
                    bail('could not find lambda ...');
                    return;
                }

                this.invokeLambda(id, eventObject, lambda);
                return;
            }
        }

        // console.log(':(');

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

        const maybePromise = fn.handler(eventObject, {}, (err, result) => {
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
