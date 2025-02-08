const path = require('path');
const fs = require('fs');
const express = require('express');
const cpen322 = require('./cpen322-tester.js');
const WebSocket = require('ws');
const Database = require('./Database.js')
const crypto = require('crypto'); 
const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'cpen322-messenger'; 
const SessionManager = require('./SessionManager.js');
var db = new Database(mongoUrl, dbName);
const { spawn } = require('child_process');

const sessionManager = new SessionManager();
let messages = {};              //initialize messages array
db.getRooms().then(rooms => {
    rooms.forEach(room => {
        messages[room._id] = []; 
    });
}).catch(err => {
    console.error("Failed to get rooms from db", err);
});

function logRequest(req, res, next){
	console.log(`${new Date()}  ${req.ip} : ${req.method} ${req.path}`);
	next();
}

const messageBlockSize = 1;
const host = 'localhost';
const port = 4000;
const clientApp = path.join(__dirname, 'client');

const broker = new WebSocket.Server({port:8000});       //message broker

broker.on('connection', (socket, request) => {
    const cookieHeader = request.headers['cookie'];

    if (!cookieHeader) {
        socket.close();
        return;
    }
    const cookies = {};
    const cookieArray = cookieHeader.split(';');
    for (let i = 0; i < cookieArray.length; i++) {
        const cookie = cookieArray[i].trim();
        const [name, ...rest] = cookie.split('=');
        const value = rest.join('=');
        cookies[name] = decodeURIComponent(value);
    }
    const token = cookies['cpen322-session'];
    const username = sessionManager.getUsername(token);
    if (!token || !username) {
        socket.close();             //invalid token or user, close connection
        return;
    }
    socket.username = username;
    socket.on('message', async(message) => {
        const messageStr = message.toString();    
        let parsedMessage;

        try {
            parsedMessage = JSON.parse(messageStr);
    
            const {roomId, text} = parsedMessage;
            const username = socket.username; // Use the username from the session
            
            const sanitizedUsername = HTMLtoString(username);
            const sanitizedText = HTMLtoString(text);
            const sanitizedMessage = {
                roomId,
                username: sanitizedUsername,
                text: sanitizedText
            };
    
            const sanitizedString = JSON.stringify(sanitizedMessage);
            broker.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(sanitizedString);
                }
            });
    
            if (messages[roomId]) {
                messages[roomId].push({ username: sanitizedUsername, text: sanitizedText });
                if (messages[roomId].length >= messageBlockSize) {
                    const conversation = {
                        room_id: roomId,
                        timestamp: Date.now(),
                        messages: messages[roomId]
                    };
                    await db.addConversation(conversation)
                        .then(() => {
                            messages[roomId] = [];
                        })
                        .catch(err => {
                            console.error('Failed to add conversation to db:', err);
                        });
                }
            } else {
                console.error(`Room with id ${roomId} not found`);
            }
        } catch (error) {
            console.error('Invalid JSON parse:', error);
        }
    });
    socket.on('close', () => { 
        console.log('Client disconnected');
    });
    socket.on('error', ()=>{
        console.error('message error');
    });
}); 
console.log('WebSocket server started on port 8000');


// express app
let app = express();

app.use(express.json()) 						// to parse application/json
app.use(express.urlencoded({ extended: true })) // to parse application/x-www-form-urlencoded
app.use(logRequest);							// logging for debug

app.post('/login', express.urlencoded({ extended: true }), async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db.getUser(username);

        if (!user) {
            return res.redirect('/login'); // User not found, redirect back to login
        }

        const bool = await isCorrectPassword(password, user.password);

        if (bool) {
            sessionManager.createSession(res, username);    //Correct password, create new seesion for user
            return res.redirect('/');
        } else {
            return res.redirect('/login');
        }
    } catch (error) {
        console.error('Error during login:', error);
        return res.redirect('/login');
    }
});

app.get('/app.js', sessionManager.middleware, (req, res) => {
    res.sendFile(path.join(clientApp, 'app.js'));
});

app.get('/index.html', sessionManager.middleware, (req, res) => {
    res.sendFile(path.join(clientApp, 'index.html'));
});

app.get('/index', sessionManager.middleware, (req, res) => {
    res.sendFile(path.join(clientApp, 'index.html'));
});
app.get('/', sessionManager.middleware, (req, res) => {
    res.sendFile(path.join(clientApp, 'index.html'));
});
app.get('/profile', sessionManager.middleware, (req, res) => {
    res.json({ username: req.username });
});
app.get('/logout', sessionManager.middleware, (req, res) => {
    sessionManager.deleteSession(req);
    res.clearCookie('cpen322-session');
    res.redirect('/login');
});

app.use('/', express.static(clientApp, { extensions: ['html'] }));

app.route('/chat')
.all(sessionManager.middleware)
.get((req, res) => {                                    // Fetch messages in db
    db.getRooms().then(rooms => {
        const chatWithMessages = rooms.map(room => ({
            _id: room._id,
            name: room.name,
            image: room.image,
            messages: messages[room._id] || []
        }));
        res.json(chatWithMessages);
    }).catch(err => {
        console.error("Failed to get rooms from db", err);
        res.status(500).json({ error: "Failed to get chat rooms" });
    });
})
.post((req, res) => {       // Given a name, create a new chatroom and add to db
    const { name, image } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Room name is required" });        // Must have room name to create room
    }

    const newRoom = {
        name: name,
        image: image || '/client/assets/everyone-icon.png'
    };

    db.addRoom(newRoom).then(room => {
        messages[room._id] = []; // Initialize messages for the new room
        res.status(200).json(room);
    }).catch(err => {
        res.status(500).json({ error: "Failed to add room" });
    });
});

app.get('/chat/:room_id', sessionManager.middleware, (req, res) => {
    const roomId = req.params.room_id;
    db.getRoom(roomId).then(room => {
        if (room) {
            res.json(room);
        } else {
            res.status(404).json({ error: `Room ${roomId} was not found` });
        }
    }).catch(err => {
        console.error("Failed to get room from db", err);
        res.status(500).json({ error: "Failed to get room" });
    });
});

app.get('/chat/:room_id/messages', sessionManager.middleware, (req, res) => {
    const roomId = req.params.room_id;
    const before = parseInt(req.query.before) || Date.now();

    db.getLastConversation(roomId, before)
        .then(conversation => {
            if (conversation) {
                res.json(conversation);
            } else {
                res.status(404).json({ error: 'No conversation found' });
            }
        })
        .catch(err => {
            console.error('Failed to get last conversation:', err);
            res.status(500).json({ error: 'Failed to get conversation' });
        });
});
app.listen(port, () => {
    console.log(`${new Date()}  App Started. Listening on ${host}:${port}, serving ${clientApp}`);
});

app.use((err, req, res, next) => {
    if (err instanceof SessionManager.Error) {
        const acceptHeader = req.headers['accept'] || '';
        if (acceptHeader.includes('application/json')) {
            res.status(401).json({ error: err.message });
        } else {
            res.redirect('/login');
        }
    } else {
        console.error('Internal Server Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/roast', sessionManager.middleware, async (req, res) => {
    const { roomId, targetUsername, targetMessage, requestId } = req.body;

    const sanitizedTargetUsername = HTMLtoString(targetUsername);
    const sanitizedTargetMessage = HTMLtoString(targetMessage);

    const pythonProcess = spawn('python', ['roast.py']);    //spawn python script

    let roastText = '';
    pythonProcess.stdout.on('data', (data) => {
        roastText += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python error: ${data}`);
    });

    pythonProcess.on('close', async (code) => {
        if (code !== 0 || roastText.trim() === '') {
            res.status(500).json({ error: 'Failed to generate roast message' });
        } else {
            const messageData = {
                roomId: roomId,
                username: 'AI',
                text: roastText.trim()
            };

            const messageString = JSON.stringify(messageData);
            broker.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(messageString);
                }
            });
            
            if (!messages[roomId]) {
                messages[roomId] = [];
            }
            messages[roomId].push({ username: 'AI', text: roastText.trim() });
    
            if (messages[roomId].length >= messageBlockSize) {  //save messages to database when messages[] is full
                const conversation = {
                    room_id: roomId,
                    timestamp: Date.now(),
                    messages: messages[roomId]
                };
    
                try {
                    await db.addConversation(conversation);
                    messages[roomId] = []; // Clear messages after saving
                } catch (error) {
                    console.error('Error saving conversation:', error);
                }
            }
            res.json({ text: roastText.trim() });
        }
    });

    const inputData = JSON.stringify({              // Send data to the Python script via stdin
        targetUsername: sanitizedTargetUsername,
        targetMessage: sanitizedTargetMessage
    });
    pythonProcess.stdin.write(inputData);
    pythonProcess.stdin.end();
});

app.post('/factcheck', sessionManager.middleware, async (req, res) => {
    const { roomId, targetUsername, targetMessage } = req.body;

    const sanitizedTargetUsername = HTMLtoString(targetUsername);
    const sanitizedTargetMessage = HTMLtoString(targetMessage);

    const pythonProcess = spawn('python', ['factcheck.py']); // Spawn the fact-checking script

    let factCheckText = '';
    pythonProcess.stdout.on('data', (data) => {
        factCheckText += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python error: ${data}`);
    });

    pythonProcess.on('close', async (code) => {
        if (code !== 0 || factCheckText.trim() === '') {
            res.status(500).json({ error: 'Failed to generate fact-check message' });
        } else {
            const messageData = {
                roomId: roomId,
                username: 'AI',
                text: factCheckText.trim()
            };

            const messageString = JSON.stringify(messageData);
            broker.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(messageString);
                }
            });

            if (!messages[roomId]) {
                messages[roomId] = [];
            }
            messages[roomId].push({ username: 'AI', text: factCheckText.trim() });

            if (messages[roomId].length >= messageBlockSize) {
                const conversation = {
                    room_id: roomId,
                    timestamp: Date.now(),
                    messages: messages[roomId]
                };

                try {
                    await db.addConversation(conversation);
                    messages[roomId] = [];
                } catch (error) {
                    console.error('Error saving conversation:', error);
                }
            }
            res.json({ text: factCheckText.trim() });
        }
    });

    const inputData = JSON.stringify({
        targetUsername: sanitizedTargetUsername,
        targetMessage: sanitizedTargetMessage
    });
    pythonProcess.stdin.write(inputData);
    pythonProcess.stdin.end();
});

function isCorrectPassword(password, saltedHash) {
    if (typeof password !== 'string' || typeof saltedHash !== 'string') {   //make sure password and saltedHash are strings
        return false;
    }

    if (saltedHash.length !== 64) {
        return false;
    }

    const salt = saltedHash.slice(0, 20);
    const storedHash = saltedHash.slice(20);

    const saltedPassword = password + salt; //concatenate password with salt

    const hash = crypto.createHash('sha256').update(saltedPassword).digest();   //Compute SHA256 hash

    const hashB64 = hash.toString('base64');    //Convert hash to base64

    return hashB64 === storedHash;
}

function HTMLtoString(str) {    //helper function to convert HTML tag characters to text
    if (typeof str !== 'string') {
        return '';
    }
    return str.replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
}
cpen322.connect('http://3.98.223.41/cpen322/test-a5-server.js');
cpen322.export(__filename, {app, db, messages, messageBlockSize, sessionManager, isCorrectPassword});