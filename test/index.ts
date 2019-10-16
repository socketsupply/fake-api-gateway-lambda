'use strict';

import { test } from './test-harness';

test('calling /hello', async (harness, assert) => {
    const res = await harness.fetch('/hello');
    assert.equal(res.status, 200);

    const b = await res.text();
    assert.equal(b, 'Hello, World!');

    assert.ok(true);
});
