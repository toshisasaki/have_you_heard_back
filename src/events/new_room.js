// Event: new room
const Users = require('../server/users.service');
const Rooms = require('../server/rooms.service');
const Server = require('../server/server.service');
const Redis = require('../server/redis.service');

const debug = require('debug')('have_you_heard');

// Initialize event listener
module.exports = function(socket) {
    socket.on('new room', async () => {
        let userID = `user_${socket.id}`;
        await Redis.getIO(async (redisIO) => {
            let user = await Users.get(redisIO, userID);

            // Check if the user exists
            if (!user) {
                console.error(`User ${userID} not found`);
                Redis.returnIO(redisIO);
                return;
            }

            // Provide callback to call when the creation is successful
            await Rooms.create(redisIO, user)
            .then(async (room) => {
                console.log(`new room ${room.id}`);

                // Join the socket before adding to receive back the broadcast with the
                // state
                socket.join(room.id);

                // Provide the callback to call when successful
                await Rooms.addUser(redisIO, userID, room.id, async (result) => {
                    let io = Server.getIO();

                    let user = result["user"];
                    let oldRoom = result["oldRoom"];
                    let newRoom = result["newRoom"];

                    // Update user in socket.io if the transaction was successful
                    if (oldRoom) {
                        socket.leave(oldRoom.id);
                        console.log(`user ${user.id} left the room ${oldRoom.id}`);
                        if (oldRoom.users.length > 0) {
                            // Replace user IDs with complete user JSONs and send
                            await Rooms.complete(redisIO, oldRoom)
                            .then((room) => {
                                debug(`room:\n` + JSON.stringify(room, null, 2));
                                io.to(room.id).emit('room', JSON.stringify(room));
                            }, (err) => {
                                console.error(err);
                            });
                        }
                    }

                    if (newRoom) {
                        // Set the new room language as the creator language
                        newRoom.language = user.language;

                        // Replace user IDs with complete user JSONs and send
                        await Rooms.complete(redisIO, newRoom)
                        .then((room) => {
                            debug(`room:\n` + JSON.stringify(room, null, 2));
                            io.to(room.id).emit('room', JSON.stringify(room));
                            console.log(`user ${user.id} joined room ${room.id}`);
                        }, (err) => {
                            console.error(err);
                        });
                    }
                }, async (err) => {
                    let io = Server.getIO();
                    // Rollback
                    console.error(`Failed to add user ${userID} to room ${room.id}: ` + err);
                    socket.leave(room.id);
                    await Rooms.destroy(redisIO, room.id);
                    io.socketsLeave(room.id);
                });
            }, (err) => {
                console.error('Could not create new room: ' + err);
            });

            // Unlock Redis IO connection
            Redis.returnIO(redisIO);
        }, (err) => {
            console.error('Could not get redis IO: ' + err);
        });
    });
};

