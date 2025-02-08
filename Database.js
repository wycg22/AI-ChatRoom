const { MongoClient, ObjectId } = require('mongodb');	// require the mongodb driver

/**
 * Uses mongodb v6.3 - [API Documentation](http://mongodb.github.io/node-mongodb-native/6.3/)
 * Database wraps a mongoDB connection to provide a higher-level abstraction layer
 * for manipulating the objects in our cpen322 app.
 */
function Database(mongoUrl, dbName){
	if (!(this instanceof Database)) return new Database(mongoUrl, dbName);
	this.connected = new Promise((resolve, reject) => {
		const client = new MongoClient(mongoUrl);

		client.connect()
		.then(() => {
			console.log('[MongoClient] Connected to ' + mongoUrl + '/' + dbName);
			resolve(client.db(dbName));
		}, reject);
	});
	this.status = () => this.connected.then(
		db => ({ error: null, url: mongoUrl, db: dbName }),
		err => ({ error: err })
	);
}

Database.prototype.getRooms = function(){
	return this.connected.then(db =>
		new Promise((resolve, reject) => {
			db.collection('chatrooms').find({}).toArray()
                .then(resolve)
                .catch(reject);
		})
	)
}

Database.prototype.getRoom = function(room_id){
	return this.connected.then(db =>
		new Promise((resolve, reject) => {
			const collection = db.collection('chatrooms');

            if (ObjectId.isValid(room_id)) {
                collection.findOne({ _id: new ObjectId(room_id) })
                    .then(room => {
                        if (room) {
                            resolve(room);  // If room found by ObjectId, resolve with the room
                        } else {
                            return collection.findOne({ _id: room_id }); // Else use string id
                        }
                    })
                    .then(room => {
                        if (room) {
                            resolve(room);  // If room found by string _id, resolve with the room
                        } else {
                            resolve(null);  // Resolve with null if no room found
                        }
                    })
                    .catch(reject); 
            } else {
                collection.findOne({ _id: room_id })
                    .then(room => resolve(room))
                    .catch(reject);
            }
        })
    );
}

Database.prototype.addRoom = function(room){
	return this.connected.then(db =>
        new Promise((resolve, reject) => {
			if (!room.name || typeof room.name !== 'string' || room.name.trim() === '') {	//check if theres a room name
                return reject(new Error("Room name missing"));
            }

            db.collection('chatrooms').insertOne(room)
                .then(result => {
                    room._id = result.insertedId;  // Assign the generated _id to the room
                    resolve(room); 
                })
                .catch(err => {
                    console.error("Error inserting room into DB:", err);
                    reject(new Error("Failed to add room to the database"));
                });
        })
    );
}

Database.prototype.getLastConversation = function(room_id, before){
	return this.connected.then(db =>
		new Promise((resolve, reject) => {
			if(!before){
				before = Date.now();
			}
			db.collection('conversations')
				.find({
					room_id: room_id,
					timestamp: {$lt: before}
				})
				.sort({timestamp: -1}) // Sort descending
				.limit(1)				//Get the most recent convo
				.toArray()
				.then(conversations => {
                    if (conversations.length > 0) {
                        resolve(conversations[0]); //resolve with convo if found
                    } else {
                        resolve(null); 
                    }
                })
                .catch(err => {
                    reject(err);
                });
		})
	)
}

Database.prototype.addConversation = function(conversation){
	return this.connected.then(db =>
		new Promise((resolve, reject) => {
			if (!conversation.room_id || !conversation.timestamp || !conversation.messages) {
                return reject(new Error('Missing required fields: room_id, timestamp, and messages'));
            }

            db.collection('conversations').insertOne(conversation)
                .then(result => {
                    conversation._id = result.insertedId;
                    resolve(conversation);
                })
                .catch(err => {
                    reject(err);
                });
		})
	)
}

Database.prototype.getUser = function(username){
    return this.connected.then(db => 
        new Promise((resolve, reject) => {
            if (!username || typeof username !== 'string') {
                return reject(new Error("Invalid username provided."));
            }

            db.collection('users').findOne({ username: username })  //Query "users" in database
                .then(user => {
                    resolve(user); // user will be the document if found, or null if not
                })
                .catch(err => {
                    console.error("Error fetching user:", err);
                    reject(err);
                });
        })
    );
}
module.exports = Database;