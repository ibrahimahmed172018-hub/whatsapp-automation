import assert from 'node:assert';
import { app } from './index.js';

const server = app.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`🧪 Running endpoint checks on ${baseUrl}...`);

  try {
    // 1. Check GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200, 'GET /health should return 200');
    console.log('✅ GET /health passed');

    // 2. Check GET /webhook verification (Valid token)
    const verifyToken = process.env.META_VERIFY_TOKEN || 'tanta_delivery_secret_token_2026';
    const challengeStr = 'CHALLENGE_STRING_12345';
    const verifyUrl = `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challengeStr}`;
    const verifyRes = await fetch(verifyUrl);
    assert.strictEqual(verifyRes.status, 200, 'Valid verification should return 200');
    const textRes = await verifyRes.text();
    assert.strictEqual(textRes, challengeStr, 'Should echo hub.challenge');
    console.log('✅ GET /webhook (valid) passed');

    // 3. Check GET /webhook verification (Invalid token)
    const invalidUrl = `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=${challengeStr}`;
    const invalidRes = await fetch(invalidUrl);
    assert.strictEqual(invalidRes.status, 403, 'Invalid token should return 403');
    console.log('✅ GET /webhook (invalid 403) passed');

    // 4. Check POST /webhook with a simulated Meta message
    const samplePayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456789',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '201000000000',
                  phone_number_id: '999888777'
                },
                contacts: [
                  {
                    profile: { name: 'أحمد من طنطا' },
                    wa_id: '201012345678'
                  }
                ],
                messages: [
                  {
                    from: '201012345678',
                    id: 'wamid.HBgTEST123',
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    text: { body: 'عايز دليفري من كرم الشام' },
                    type: 'text'
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    const postRes = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload)
    });
    assert.strictEqual(postRes.status, 200, 'POST /webhook should return 200');
    console.log('✅ POST /webhook simulation passed');

    console.log('\n🎉 ALL CHECKS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('❌ Check failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    process.exit(process.exitCode || 0);
  }
});
