const axios = require('axios');
require('dotenv').config();

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

async function testCloudflare() {
    console.log('=== CLOUDFLARE STREAM TEST ===');
    console.log('Account ID:', accountId);
    console.log('API Token:', apiToken ? '✅ Present' : '❌ Missing');

    if (!accountId || !apiToken) {
        console.log('❌ Missing credentials in .env file');
        return;
    }

    // Test 1: Check account info
    try {
        console.log('\n📡 Testing account access...');
        const accountResponse = await axios.get(
            `https://api.cloudflare.com/client/v4/accounts`,
            {
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (accountResponse.data.success) {
            console.log('✅ Account access successful!');
            console.log('Account name:', accountResponse.data.result[0]?.name);
        } else {
            console.log('❌ Account access failed:', accountResponse.data.errors);
        }
    } catch (error) {
        console.log('❌ Account access error:', error.response?.data || error.message);
    }

    // Test 2: Check Stream availability
    try {
        console.log('\n📡 Testing Stream access...');
        const streamResponse = await axios.get(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live/inputs`,
            {
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (streamResponse.data.success) {
            console.log('✅ Stream access successful!');
            console.log('Stream inputs:', streamResponse.data.result.length);
        } else {
            console.log('❌ Stream access failed:', streamResponse.data.errors);
        }
    } catch (error) {
        console.log('❌ Stream access error:', error.response?.data || error.message);
    }
}

testCloudflare();