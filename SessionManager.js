const crypto = require('crypto');

class SessionError extends Error { };

function SessionManager() {
    // default session length - you might want to
    // set this to something small during development
    const CookieMaxAgeMs = 600000;

    // keeping the session data inside a closure to keep them protected
    const sessions = {};

    // might be worth thinking about why we create these functions
    // as anonymous functions (per each instance) and not as prototype methods
    this.createSession = (response, username, maxAge = CookieMaxAgeMs) => {
        const token = crypto.randomBytes(32).toString('hex');

        const sessionData = {
            username: username,
            createdAt: Date.now(),
            expiresAt: Date.now() + maxAge,
        };

        sessions[token] = sessionData;  //store session data in sessions[] with token as the key

        response.cookie('cpen322-session', token, { maxAge: maxAge });

        setTimeout(() => {              //delete session data after specified time
            delete sessions[token];
        }, maxAge);
    };

    this.deleteSession = (request) => {
        const token = request.session;
        delete request.username;
        delete request.session;
    
        if (token && sessions[token]) {
            delete sessions[token];
        }
    };

    this.middleware = (request, response, next) => {
        try {
            const header = request.headers['cookie'];
            if (!header) {
                return next(new SessionError('No cookies found'));
            };
            const cookies = {};
            const cooks = header.split(';');
            for (let i = 0; i < cooks.length; i++) {
                const cookie = cooks[i].trim();
                const cookieParts = cookie.split('=');        //split into name and value
                const name = cookieParts[0];
                const value = cookieParts.slice(1).join('=');   //join the rest of cookie parts in case '=' is in value                     
                cookies[name] = decodeURIComponent(value);      //store cookie name and value in cookies
            }
            const token = cookies['cpen322-session'];
            if (!token || !sessions[token]) {
                return next(new SessionError('Invalid session token'));
            }
            request.username = sessions[token].username;
            request.session = token;
            next();
        } catch (error) {
            next(error);
        }
    };

    // this function is used by the test script.
    // you can use it if you want.
    this.getUsername = (token) => ((token in sessions) ? sessions[token].username : null);
};

// SessionError class is available to other modules as "SessionManager.Error"
SessionManager.Error = SessionError;

module.exports = SessionManager;