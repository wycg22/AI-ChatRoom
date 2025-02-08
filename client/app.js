// Removes the contents of the given DOM element (equivalent to elem.innerHTML = '' but faster)
function emptyDOM(elem) {
    while (elem.firstChild) elem.removeChild(elem.firstChild);
}

// Creates a DOM element from the given HTML string
function createDOM(htmlString) {
    let template = document.createElement('template');
    template.innerHTML = htmlString.trim();
    return template.content.firstChild;
}

function* makeConversationLoader(room) {
    let lastTimestamp = null;

    while (true) {
        if (!room.canLoadConversation) {
            room.canLoadConversation = true;
            break; // Exit if loading is not allowed
        }

        room.canLoadConversation = false;
        if (lastTimestamp == null) {
            lastTimestamp = room.createdAt;
        }
        const promise = Service.getLastConversation(room._id, lastTimestamp)
            .then(conversation => {
                if (conversation) {
                    lastTimestamp = conversation.timestamp;
                    room.addConversation(conversation);
                    room.canLoadConversation = true;

                    return conversation;
                } else {
                    return null;
                }
            })
            .catch(error => {
                console.error('Error fetching conversation:', error);
                room.canLoadConversation = true;    // enable loading
                return null;
            });

        const conversation = yield promise;

        if (conversation === null) {
            room.canLoadConversation = true;
            break; // Terminate the generator if no more conversations
        }
    }
    room.canLoadConversation = true;
}
class LobbyView {
    constructor(lobby) {
        this.lobby = lobby;
        this.elem = createDOM(`
            <div class="content">
                <button id="sign-out-button">Sign Out</button>
                <ul class="room-list">
                    
                </ul>
                <div class="page-control">
                    <input type="text" placeholder="Room Name">
                    <button type="button">Create Room</button>
                </div>
            </div>
        `);
        this.listElem = this.elem.querySelector('.room-list');
        this.inputElem = this.elem.querySelector('input[type="text"]');
        this.buttonElem = this.elem.querySelector('button');
        this.signOutButton = this.elem.querySelector('#sign-out-button');

        this.lobby.onNewRoom = (newRoom) => {
            const listItem = createDOM(`
                <li><a href="#/chat/${newRoom._id}">${newRoom.name}</a></li>
            `);
            this.listElem.appendChild(listItem);
        };
        this.redrawList();

        this.buttonElem.addEventListener('click', () => {
            const roomName = this.inputElem.value.trim();
            if (roomName) {
                Service.addRoom({ name: roomName })
                    .then(newRoom => {
                        if (newRoom) {
                            this.lobby.addRoom(newRoom._id, newRoom.name, newRoom.image);
                            this.inputElem.value = '';
                            this.redrawList();
                        }
                    })
                    .catch(error => {
                        console.error('Error creating room:', error);
                    });
            }
        });
        this.signOutButton.addEventListener('click', () => {
            fetch(`${Service.origin}/logout`)
                .then(() => {
                    window.location.href = '/login#';
                })
                .catch(error => {
                    console.error('Failed to sign out:', error);
                });
        });
    }

    redrawList() {
        emptyDOM(this.listElem);

        for (const roomId in this.lobby.rooms) {
            const room = this.lobby.rooms[roomId];
            const listItem = createDOM(`
                    <li><a href="#/chat/${roomId}">${room.name}</a></li>
                `);

            this.listElem.appendChild(listItem);
        }
    }
}

class ChatView {
    constructor(socket) {
        this.socket = socket;
        this.elem = createDOM(`
            <div class="content">
                <h4 class="room-name"></h4>
                <div class="message-list" style="overflow-y: scroll; height: 400px;">
                    <!-- Messages will be dynamically loaded here -->
                </div>
                <div class="page-control">
                    <textarea placeholder="Type your message here..."></textarea>
                    <button type="button">Send</button>
                </div>
            </div>
        `);
        this.titleElem = this.elem.querySelector('h4.room-name');
        this.chatElem = this.elem.querySelector('.message-list');
        this.inputElem = this.elem.querySelector('textarea');
        this.buttonElem = this.elem.querySelector('button');
        this.room = null;
        this.loadID = 0; // Initialize loading message ID
        this.startID = 0;
        this.pendingAI = new Map(); // Map to track loading AI messages

        this.buttonElem.addEventListener('click', () => this.sendMessage());
        this.inputElem.addEventListener('keyup', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                this.sendMessage();
                event.preventDefault();
            }
        });

        this.chatElem.addEventListener('wheel', (event) => {
            const isAtTop = this.chatElem.scrollTop < 1; // Adjust threshold as needed
            const isScrollingUp = event.deltaY <= 0; // User is scrolling up
            const canLoad = this.room && this.room.canLoadConversation; // Room exists and can load

            if (isAtTop && isScrollingUp && canLoad) {
                event.preventDefault();

                if (this.isLoading) return; // Prevents rapid trigger for scrollwheel

                this.isLoading = true;

                const loader = this.room.getLastConversation.next();
                if (!loader.done) {
                    loader.value.then(conversation => {
                        this.room.getLastConversation.next(conversation); // get previous conversation
                        this.isLoading = false;
                        if (conversation === null) {
                            console.log('No more conversations to load.');
                        }
                    }).catch(() => {
                        this.isLoading = false;
                    });
                }
            }
        });
    }


    sendMessage() {
        const message = this.inputElem.value.trim();
        if (message) {
            // this.room.addMessage(profile.username, message);
            this.inputElem.value = '';
            const messageData = {
                roomId: this.room._id,
                username: profile.username,
                text: message
            };
            this.socket.send(JSON.stringify(messageData));
        }
    }

    setRoom(room) {
        this.room = room;
        this.titleElem.textContent = room.name;
        this.isLoading = false;

        emptyDOM(this.chatElem);

        for (let i = 0; i < this.room.messages.length; i++) {
            const message = this.room.messages[i];
            this.renderMessage(message, false);
        }


        this.room.onNewMessage = (message) => {
            if (message.username === 'AI') {
                const requestId = this.startID;
                this.startID++;
                const loadingMessage = this.pendingAI.get(requestId);

                if (loadingMessage) {
                    const loadingElem = this.chatElem.querySelector(`.message.loading[data-request-id="${requestId}"]`);

                    if (loadingElem) {
                        this.chatElem.removeChild(loadingElem); //remove loading message from chat
                    }
                    const aiMessage = {
                        username: 'AI',
                        text: message.text,
                        isLoading: false,
                    };

                    this.renderMessage(aiMessage, false);
                    this.pendingAI.delete(requestId);       //remove loading message from pending messages

                    if (this.pendingAI.size === 0) {    //reset loadID
                        this.loadID = 0;
                        this.startID = 0;
                    }
                }
            } else {
                this.renderMessage(message, false);
            }
            this.chatElem.scrollTop = this.chatElem.scrollHeight;
            console.log("Message added:", message);
        };

        this.room.onFetchConversation = (conversation) => {
            const oldScrollHeight = this.chatElem.scrollHeight;
            const messages = conversation.messages;
            for (let i = messages.length - 1; i >= 0; i--) {
                this.renderMessage(messages[i], true);
            }

            const newScrollHeight = this.chatElem.scrollHeight;
            this.chatElem.scrollTop = newScrollHeight - oldScrollHeight;
        };

    }
    renderMessage(message, prepend) {
        const messageBox = document.createElement('div');
        messageBox.className = 'message';

        if (message.username === 'AI') {
            messageBox.classList.add('ai-message'); // Add 'my-message' class
        }
        else if (message.username === profile.username) {
            messageBox.classList.add('my-message'); // Add 'my-message' class
        }

        if (message.isLoading) {                //Add 'loading' class
            messageBox.classList.add('loading');
            messageBox.setAttribute('data-request-id', message.requestId);
        }
        const userSpan = document.createElement('span');
        userSpan.className = 'message-user';
        userSpan.textContent = message.username;

        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.textContent = message.text;

        messageBox.appendChild(userSpan);
        messageBox.appendChild(textSpan);

        if (message.username !== profile.username && message.username !== 'AI') {            //render a roast button for other user messages
            const roastButton = document.createElement('button');
            roastButton.className = 'roast-button';
            roastButton.textContent = 'Roast';
            messageBox.appendChild(roastButton);

            roastButton.addEventListener('click', () => {
                this.roastUser(message);
            });

            const factCheckButton = document.createElement('button');       //render fact check button
            factCheckButton.className = 'fact-check-button';
            factCheckButton.textContent = 'Fact?';
            messageBox.appendChild(factCheckButton);

            factCheckButton.addEventListener('click', () => {
                this.factCheckMessage(message);
            });
        }

        if (prepend) {
            this.chatElem.insertBefore(messageBox, this.chatElem.firstChild);   //Add old conversations when scrolling up
        } else {
            this.chatElem.appendChild(messageBox);      //loads new messages
        }
    }

    // Generate a roast message
    roastUser(message) {
        const data = {
            roomId: this.room._id,
            targetUsername: message.username,
            targetMessage: message.text
        };

        const requestId = this.loadID;
        this.loadID += 1; // Increment loadID for next request

        const loadingMessage = {        // Display loading message
            username: 'AI',
            text: 'Loading response...',
            isLoading: true, // flag to identify the loading message
            requestId: requestId
        };
        this.renderMessage(loadingMessage, false);
        this.chatElem.scrollTop = this.chatElem.scrollHeight;
        this.pendingAI.set(requestId, loadingMessage);
        fetch(`${Service.origin}/roast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
            .then(response => {
                if (response.ok) {
                    return response.json();
                } else {
                    return response.text().then(errorMsg => {
                        throw new Error(errorMsg || 'Failed to generate roast message');
                    });
                }
            })
            .catch(error => {
                console.error('Error generating roast message:', error);
            });
    }

    factCheckMessage(message) {
        const data = {
            roomId: this.room._id,
            targetUsername: message.username,
            targetMessage: message.text
        };
    
        const requestId = this.loadID;
        this.loadID += 1; // Increment loadID for next request
    
        const loadingMessage = {
            username: 'AI',
            text: 'Fact-checking...',
            isLoading: true,
            requestId: requestId
        };
        this.renderMessage(loadingMessage, false);
        this.chatElem.scrollTop = this.chatElem.scrollHeight;
        this.pendingAI.set(requestId, loadingMessage);
    
        fetch(`${Service.origin}/factcheck`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
            .then(response => {
                if (response.ok) {
                    return response.json();
                } else {
                    return response.text().then(errorMsg => {
                        throw new Error(errorMsg || 'Failed to generate fact-check message');
                    });
                }
            })
            .catch(error => {
                console.error('Error generating fact-check message:', error);
            });
    }

}

const profile = {};
class ProfileView {
    constructor() {
        this.elem = createDOM(`
            <div class="content">
                <div class="profile-form">
                    <div class="form-field">
                        <label for="Username">Username:</label>
                        <input type="text" id="Username" value="${profile.username}" disabled>
                    </div>
                    <div class="form-field">
                        <label for="Password">Password:</label>
                        <input type="password" id="Password" placeholder="Enter new password">
                    </div>
                    <div class="form-field">
                        <label for="AvatarImage">Avatar Image:</label>
                        <input type="file" id="AvatarImage" accept="image/*">
                    </div>
                </div>
                <div class="page-control">
                    <button type="button" id="save-profile-button">Save</button>
                    <button type="button" id="sign-out-button">Sign Out</button> <!-- Sign Out Button -->
                </div>
            </div>
        `);
        this.signOutButton = this.elem.querySelector('#sign-out-button');

        this.signOutButton.addEventListener('click', () => {
            fetch(`${Service.origin}/logout`)
                .then(() => {
                    window.location.href = '/login.html';
                })
                .catch(error => {
                    console.error('Failed to sign out:', error);
                });
        });
    }

}


class Room {
    constructor(_id, name, image = 'assets/everyone-icon.png', messages = []) {
        this._id = _id;
        this.id = _id; //for some reason the test file still uses .id in test 5.1 and 5.2
        this.name = name;
        this.image = image;
        this.messages = messages;
        this.onNewMessage = null;
        this.onFetchConversation = null;
        this.canLoadConversation = true;
        this.getLastConversation = makeConversationLoader(this);
        this.createdAt = Date.now(); //timestamp of when room instance was created
    }

    addMessage(username, text) {
        if (text.trim() === '') return;
        const message = { username, text };
        this.messages.push(message);

        if (typeof this.onNewMessage === 'function') {
            this.onNewMessage(message, true);
        }
    }

    addConversation(conversation) {
        if (Array.isArray(conversation.messages) && conversation.messages.length > 0) { // check conversation has messages
            this.messages = conversation.messages.concat(this.messages);    // merge with existing messages
            if (typeof this.onFetchConversation === 'function') {
                this.onFetchConversation(conversation);
            }
        }
    }
}

class Lobby {
    constructor() {
        this.rooms = {};
        this.onNewRoom = null;

        Service.getAllRooms()               //Fetch rooms from server
            .then((fetchedRooms) => {
                for (const r of fetchedRooms) {
                    this.rooms[r._id] = new Room(r._id, r.name, r.image, r.messages);
                }

                if (this.onNewRoom) {
                    for (const rId in this.rooms) {
                        this.onNewRoom(this.rooms[rId]);
                    }
                }
            })
            .catch((error) => {
                console.error("getAllRooms failed", error);
            });
    }


    getRoom(roomId) {
        return this.rooms[roomId];
    }

    addRoom(_id, name, image = 'assets/everyone-icon.png', messages = []) {
        const newRoom = new Room(_id, name, image, messages);
        this.rooms[_id] = newRoom;

        if (typeof this.onNewRoom === 'function') {
            this.onNewRoom(newRoom);
        }

    }

}

function main() {
    cpen322.setDefault('webSocketServer', 'ws://localhost:8000');
    Service.getProfile()
        .then(userProfile => {
            profile.username = userProfile.username;
            const profileView = new ProfileView();
            const lobby = new Lobby();
            const lobbyView = new LobbyView(lobby);
            const socket = new WebSocket('ws://localhost:8000');
            const chatView = new ChatView(socket);
            socket.addEventListener('message', (event) => {
                try {
                    const messageData = JSON.parse(event.data);         //parse the message
                    const { roomId, username, text } = messageData;
                    const room = lobby.getRoom(roomId);
                    if (room) {                                     //Check if roomID is valid
                        room.addMessage(username, text);
                    }
                    else {
                        console.error('Room with ID ${roomId} not found.');
                    }
                } catch (error) {
                    console.error('Failed to parse message:', error);
                }

            });
            socket.addEventListener('error', (error) => {
                console.error('WebSocket error:', error);
            });
            function renderRoute() {
                const currentHash = window.location.hash;
                const pageView = document.getElementById('page-view');

                emptyDOM(pageView);

                if (currentHash === '#' || currentHash === "" || currentHash === "#/") {
                    pageView.appendChild(lobbyView.elem);
                } else if (currentHash.startsWith('#/chat/')) {
                    const roomId = currentHash.split('/')[2];
                    var room = lobby.getRoom(roomId);

                    if (room) {
                        chatView.setRoom(room);
                        pageView.appendChild(chatView.elem);
                    } else {
                        Service.getAllRooms().then(fetchedRooms => {
                            lobby.rooms = {};
                            fetchedRooms.forEach(r => lobby.addRoom(r._id, r.name, r.image, r.messages));
                            room = lobby.getRoom(roomId);
                            if (room) {
                                chatView.setRoom(room);
                                pageView.appendChild(chatView.elem);
                            } else {
                                const errorElem = createDOM('<p>Room not found!</p>');
                                pageView.appendChild(errorElem);
                            }
                        }).catch(error => {
                            console.error('Failed to fetch rooms:', error);
                        });
                    }
                } else if (currentHash === '#/profile') {
                    pageView.appendChild(profileView.elem);
                }
            }
            window.addEventListener('popstate', renderRoute);
            renderRoute();

            function refreshLobby() {
                Service.getAllRooms()
                    .then((fetchedRooms) => {
                        for (const r of fetchedRooms) {
                            if (lobby.rooms[r._id]) {            // If room exists, update name and image
                                lobby.rooms[r._id].name = r.name;
                                lobby.rooms[r._id].image = r.image;
                            } else {
                                lobby.addRoom(r._id, r.name, r.image, r.messages);   //Else add new room
                            }
                        }
                        lobbyView.redrawList(); //Update page after refreshing
                    })
                    .catch((error) => {
                        console.error("refreshLobby failed:", error);
                    });
            }
            refreshLobby();
            setInterval(refreshLobby, 5000);
            cpen322.export(arguments.callee, {
                lobby: lobby,
                chatView: chatView
            });
        })
        .catch(error => {
            console.error('Failed to get profile:', error);
            window.location.href = '/login';
        });
}
window.addEventListener('load', main);

const Service = {
    origin: window.location.origin,
    getAllRooms: function () {
        return fetch(`${Service.origin}/chat`)  //AJAX request to /chat
            .then(response => {
                if (response.ok) {
                    return response.json(); //parse and return if response is successful
                } else {
                    return response.text()
                        .then(errorMess => {
                            return Promise.reject(new Error(errorMess || `Server error: ${response.status}`));
                        });
                }
            })
            .catch(error => {
                return Promise.reject(new Error(error.message || 'Some error occurred'));
            });
    },


    addRoom: async function (data) {
        try {
            let response = await fetch(this.origin + '/chat', { //wait for fetch request to complete
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)          //Convert to string
            });

            if (!response.ok) {         //Handle errors
                const errorMsg = await response.text();
                throw new Error(errorMsg || 'Failed to create room');
            }

            return await response.json();
        } catch (error) {

            return Promise.reject(error);
        }
    },

    getLastConversation: function (roomId, before) {
        let url = `${Service.origin}/chat/${roomId}/messages`;
        if (before) {
            url += `?before=${before}`; //return conversations before a given timestamp
        }
        return fetch(url)
            .then(response => {
                if (response.ok) {
                    return response.json();
                } else if (response.status === 404) {
                    return null; // No conversation found
                } else {
                    return response.text()
                        .then(errorMess => {
                            return Promise.reject(new Error(errorMess || `Server error: ${response.status}`));
                        });
                }
            })
            .catch(error => {
                return Promise.reject(new Error(error.message || 'Some error occurred'));
            });
    },
    getProfile: function () {
        return fetch(`${Service.origin}/profile`)
            .then(response => {
                if (response.ok) {
                    return response.json();
                } else {
                    return response.text()
                        .then(errorMess => {
                            return Promise.reject(new Error(errorMess || `Server error: ${response.status}`));
                        });
                }
            })
            .catch(error => {
                return Promise.reject(new Error(error.message || 'Some error occurred'));
            });
    },
};