// Event: disconnect
const Users = require('../server/users.service');
const Rooms = require('../server/rooms.service');
const Server = require('../server/server.service');
const Games = require('../server/games.service');

const Redis = require('../server/redis.service');
const debug = require('debug')('have_you_heard');

// Initialize event listener
module.exports = function(socket) {
    socket.on('disconnect', async () => {
        console.log(`socket ID ${socket.id} disconnected`);
        let userID = `user_${socket.id}`

        await Redis.getIO(async (redisIO) => {
            let user = await Users.get(redisIO, userID);
            if (user) {
                if (user.game) {

                    //TODO Update game state

                    await Games.removePlayer(redisIO, userID, user.game, async (game) => {
                        let io = Server.getIO();
                        // If the user was in the game
                        if (game) {
                            debug(`game:\n` + JSON.stringify(game, null, 2));
                            console.log(`user ${user.id} left the game ${game.id}`);
                        }
                    }, (err) => {
                        console.error(`Could not remove user ${userID} from game ${user.game}: ` + err);
                    });
                }

                if (user.room) {
                    await Rooms.removeUser(redisIO, userID, user.room, async (result) => {
                        let io = Server.getIO();
                        let user = result["user"];
                        let oldRoom = result["oldRoom"];
                        // Update user in socket.io if the transaction was successful

                        if (oldRoom) {
                            socket.leave(oldRoom.id);
                            console.log(`user ${user.id} left the room ${oldRoom.id}`);
                            if (oldRoom.users.length > 0) {
                                // Replace user IDs with complete user JSONs and send
                                Rooms.complete(redisIO, oldRoom)
                                .then((room)=> {
                                    debug(`room:\n` + JSON.stringify(room, null, 2));
                                    io.to(room.id).emit('room', JSON.stringify(room));
                                }, (err) => {
                                    console.error(err);
                                });
                            }
                        }

                        await Users.destroy(redisIO, userID);
                        console.log(`User ${user.id} was deleted`);
                    }, (err) => {
                        console.error(`Could not remove user ${userID} from room ${user.room}: ` + err);
                    });
                } else {
                    await Users.destroy(redisIO, userID);
                    console.log(`User ${user.id} was deleted`);
                }
            }

            Redis.returnIO(redisIO);
        }, (err) => {
            console.error('Could not get Redis IO: ' + err);
        });
    });
};

