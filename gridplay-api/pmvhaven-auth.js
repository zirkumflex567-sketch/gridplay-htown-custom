'use strict';
const fs = require('fs/promises');
const path = require('path');

const AUTH_FILE_PATH = process.env.PMVHAVEN_AUTH_PATH || path.join(__dirname, 'data', 'pmvhaven-auth.json');

async function loadAuth() {
    try {
        const raw = await fs.readFile(AUTH_FILE_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && typeof data.cookies === 'string') {
            return data;
        }
        return null;
    } catch (_) {
        return null;
    }
}

async function saveAuth(data) {
    try {
        await fs.mkdir(path.dirname(AUTH_FILE_PATH), { recursive: true });
        await fs.writeFile(AUTH_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Failed to save PMVHaven auth file:', e.message);
        return false;
    }
}

async function clearAuth() {
    try {
        await fs.unlink(AUTH_FILE_PATH);
    } catch (_) {}
    return true;
}

function parseSetCookie(headers) {
    let list = [];
    if (typeof headers.getSetCookie === 'function') {
        list = headers.getSetCookie();
    } else {
        const raw = headers.get('set-cookie');
        if (raw) list = [raw];
    }

    const cookieMap = new Map();
    for (const item of list) {
        const parts = item.split(';');
        const first = (parts[0] || '').trim();
        const eqIdx = first.indexOf('=');
        if (eqIdx > 0) {
            const name = first.slice(0, eqIdx).trim();
            const val = first.slice(eqIdx + 1).trim();
            cookieMap.set(name, val);
        }
    }

    const res = [];
    for (const [name, val] of cookieMap.entries()) {
        res.push(`${name}=${val}`);
    }
    return res.join('; ');
}

async function checkSession(cookieString) {
    if (!cookieString) return { authenticated: false, user: null };
    try {
        const res = await fetch('https://pmvhaven.com/api/auth/session', {
            headers: {
                'Cookie': cookieString,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Referer': 'https://pmvhaven.com/',
                'Accept': 'application/json'
            }
        });
        if (!res.ok) {
            return { authenticated: false, user: null, error: `HTTP ${res.status}` };
        }
        const data = await res.json();
        if (data && data.user) {
            return { authenticated: true, user: data.user, session: data.session || null };
        }
        return { authenticated: false, user: null };
    } catch (e) {
        return { authenticated: false, user: null, error: e.message };
    }
}

async function loginWithEmail(email, password, rememberMe = true) {
    if (!email || !password) {
        throw new Error('Email und Passwort sind erforderlich.');
    }

    const response = await fetch('https://pmvhaven.com/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://pmvhaven.com',
            'Referer': 'https://pmvhaven.com/login',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({
            email: email.trim(),
            password: password,
            rememberMe: Boolean(rememberMe)
        })
    });

    const cookieString = parseSetCookie(response.headers);

    let body = null;
    try {
        body = await response.json();
    } catch (_) {}

    if (!response.ok) {
        const msg = (body && (body.message || body.error)) || `Login fehlgeschlagen (HTTP ${response.status})`;
        throw new Error(msg);
    }

    const check = await checkSession(cookieString);
    const user = check.authenticated ? check.user : (body && body.user ? body.user : { email });

    const authData = {
        cookies: cookieString,
        user,
        email: email.trim(),
        updatedAt: new Date().toISOString()
    };
    await saveAuth(authData);

    return { ok: true, user, cookiesSaved: Boolean(cookieString) };
}

async function loginWithCookie(rawCookie) {
    if (!rawCookie || typeof rawCookie !== 'string') {
        throw new Error('Cookie-String ist erforderlich.');
    }
    const cookieString = rawCookie.trim();
    const check = await checkSession(cookieString);
    if (!check.authenticated) {
        throw new Error('Cookie ist ungültig oder abgelaufen (PMVHaven Session nicht aktiv).');
    }

    const authData = {
        cookies: cookieString,
        user: check.user,
        updatedAt: new Date().toISOString()
    };
    await saveAuth(authData);

    return { ok: true, user: check.user };
}

async function getAuthHeader() {
    const auth = await loadAuth();
    if (auth && auth.cookies) {
        return auth.cookies;
    }
    return null;
}

module.exports = {
    loadAuth,
    saveAuth,
    clearAuth,
    checkSession,
    loginWithEmail,
    loginWithCookie,
    getAuthHeader
};
