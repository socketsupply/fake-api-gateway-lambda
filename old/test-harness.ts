'use strict';

import * as tape from '@pre-bundled/tape';
import * as tapeCluster from 'tape-cluster';
import * as path from 'path';
import fetch from 'node-fetch';

import {
    FakeApiGatewayLambda,
    PopulateRequestContextFn
} from '../src/index';

type FetchResponse = import('node-fetch').Response;
type FetchRequestInit = import('node-fetch').RequestInit;

interface Dictionary<T> {
    [key: string]: T;
}

class TestHarness {
    lambda: FakeApiGatewayLambda;

    constructor(options: {
        env?: Dictionary<string>,
        requestContext?: PopulateRequestContextFn
    } = {}) {
        this.lambda = new FakeApiGatewayLambda({
            port: 0,
            env: options.env,
            populateRequestContext: options.requestContext,
            routes: {
                '/hello': path.join(__dirname, 'lambdas', 'hello.js')
            }
        });
    }

    async fetch(
        url: string,
        init?: FetchRequestInit
    ): Promise<FetchResponse> {
        return fetch(`http://${this.lambda.hostPort}${url}`, init);
    }

    async bootstrap(): Promise<void> {
        await this.lambda.bootstrap();
    }

    async close(): Promise<void> {
        await this.lambda.close();
    }
}

export const test = tapeCluster(tape, TestHarness);
