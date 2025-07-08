const { execSync } = require('child_process');
const fs = require('node:fs');

const LOG_FILENAME = 'last-run.json';
const INTERNAL_FILENAME = 'internal.json';
const CONFIG_FILENAME = 'config.json';
const UPDATES_FILENAME = 'updates.json';

const currentTime = new Date().toLocaleString();
let config = {};
let internal = {};
let log = {};

process.on('uncaughtException', error => handleError(error.message));

checkUpdate();

// FUNCTIONS

async function checkUpdate() {
    log.domainLogs = [];
    log.currentTime = currentTime;
    console.log('Current Time: ' + currentTime);

    const publicIpAddress = getPublicIpAddress();
    log.publicIpAddress = publicIpAddress;
    console.log('Current Public IP Address: ' + publicIpAddress);

    config = loadJson(CONFIG_FILENAME);
    internal = loadJson(INTERNAL_FILENAME);

    const newInternal = {};
    const domainUpdates = [];

    for (let domainName of config.domains) {
        if (!internal[domainName]
            || !internal[domainName].ipAddress
            || internal[domainName].ipAddress !== publicIpAddress) {
            try {
                const updatedDomain = await updateDomain(domainName, publicIpAddress);
                newInternal[domainName] = { ipAddress: publicIpAddress };
                if (updatedDomain.updated) {
                    domainUpdates.push(updatedDomain);
                }
                log.domainLogs.push(updatedDomain);
            } catch (error) {
                newInternal[domainName] = internal[domainName];
                log.domainLogs.push({
                    domain: domainName,
                    message: error.message,
                    updated: false
                });
            }
        } else {
            newInternal[domainName] = internal[domainName];
            log.domainLogs.push({
                domain: domainName,
                message: 'No attempt to change IP address because it has not changed',
                updated: false
            });
        }
    }

    saveJson(INTERNAL_FILENAME, newInternal);

    let updates = loadJson(UPDATES_FILENAME);
    if (domainUpdates.length > 0) {
        updates = { ...updates, [currentTime]: domainUpdates };
    }
    saveJson(UPDATES_FILENAME, updates);

    saveJson(LOG_FILENAME, log);

    console.log('DONE');
}

function getPublicIpAddress() {
    const publicIpAddress = (execSync('dig +short myip.opendns.com @resolver1.opendns.com') || '').toString().trim();

    if (!publicIpAddress) {
        throw new Error('No Public IP Address found');
    }

    return publicIpAddress;
}

function loadJson(fileName) {
    if (fs.existsSync(__dirname + '/' + fileName)) {
        const data = fs.readFileSync(__dirname + '/' + fileName, 'utf8');
        return JSON.parse(data);
    } else {
        return {};
    }
}

async function updateDomain(domainName, ipAddress) {
    let json = await sendRequest(`/zones?name=${domainName}`, 'GET');
    if (json.result.length === 0) {
        throw new Error('Domain not found in Cloudflare');
    }
    const zoneId = json.result[0].id;

    json = await sendRequest(`/zones/${zoneId}/dns_records?type=A`, 'GET');
    if (json.result.length === 0) {
        throw new Error('Type "A" DNS record not found');
    }
    const currentIpAddress = json.result[0].content;
    if (currentIpAddress === ipAddress) {
        return {
            domain: domainName,
            oldIpAddress: currentIpAddress,
            newIpAddress: ipAddress,
            updated: false
        };
    }
    const dnsRecordId = json.result[0].id;

    await sendRequest(`/zones/${zoneId}/dns_records/${dnsRecordId}`, 'PATCH', { content: ipAddress });

    return {
        domain: domainName,
        oldIpAddress: currentIpAddress,
        newIpAddress: ipAddress,
        updated: true
    };
}

async function sendRequest(path, method, body = null) {
    const response = await fetch(`${config.api}${path}`, {
        method: method,
        headers: {
            'Authorization': `Bearer ${config.token}`
        },
        body: body ? JSON.stringify(body) : null
    });

    if (!response.ok) {
        throw new Error(`Response status: ${response.status}`);
    }

    return await response.json();
}

function saveJson(fileName, data) {
    fs.writeFileSync(__dirname + '/' + fileName, JSON.stringify(data, null, 2));
}

function handleError(message) {
    log.message = message;
    saveJson(LOG_FILENAME, log);
    console.log('FAILED')
    process.exit(1);
}
