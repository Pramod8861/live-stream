const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const http = require('http');
const socketIo = require('socket.io');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Firebase with environment variables
const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// ✅ Enable ignoreUndefinedProperties to prevent undefined errors
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const app = express();
const server = http.createServer(app);

// Socket.IO for WebRTC signaling
const io = socketIo(server, {
    cors: {
        origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
        credentials: true
    }
});

app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true
}));
app.use(express.json());

// Track active streams
const activeStreams = new Map(); // streamId -> { host: socketId, viewers: Set }

io.on('connection', (socket) => {
    console.log('🟢 Client connected:', socket.id);

    // Host starts stream
    socket.on('host-start', async (data) => {
        const { streamId, title, description, userName } = data;

        console.log('📡 Host starting stream:', streamId);
        console.log('👤 Host name:', userName);

        // ✅ Ensure userName has a default value
        const safeUserName = userName || 'Anonymous Host';

        // Save to Firebase
        await db.collection('streams').doc(streamId).set({
            title: title || 'Untitled Stream',
            description: description || '',
            streamerName: safeUserName,
            status: 'live',
            viewerCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Track this stream
        activeStreams.set(streamId, {
            host: socket.id,
            viewers: new Set()
        });

        socket.join(`stream-${streamId}`);
        socket.emit('host-ready', { streamId });
    });

    // Viewer joins stream
    socket.on('viewer-join', (streamId) => {
        const stream = activeStreams.get(streamId);
        if (!stream) {
            socket.emit('error', 'Stream not found');
            return;
        }

        socket.join(`stream-${streamId}`);
        stream.viewers.add(socket.id);

        // Tell host about new viewer
        io.to(stream.host).emit('viewer-joined', {
            viewerId: socket.id,
            count: stream.viewers.size
        });

        // Update viewer count for all
        io.to(`stream-${streamId}`).emit('viewer-count', stream.viewers.size);

        console.log(`👤 Viewer joined, ${stream.viewers.size} viewers`);
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        const { to, offer } = data;
        io.to(to).emit('offer', {
            offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        const { to, answer } = data;
        io.to(to).emit('answer', {
            answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        const { to, candidate } = data;
        io.to(to).emit('ice-candidate', {
            candidate,
            from: socket.id
        });
    });

    // Chat
    socket.on('send-message', async (data) => {
        const { streamId, message, userName } = data;

        await db.collection('chats').add({
            streamId,
            message: message || '',
            userName: userName || 'Anonymous',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        io.to(`stream-${streamId}`).emit('new-message', {
            userName: userName || 'Anonymous',
            message,
            timestamp: new Date().toISOString()
        });
    });

    // Host stops stream
    socket.on('host-stop', (streamId) => {
        io.to(`stream-${streamId}`).emit('stream-ended');
        activeStreams.delete(streamId);

        db.collection('streams').doc(streamId).update({
            status: 'ended'
        }).catch(err => console.log('Stream already deleted'));

        console.log('🔴 Stream ended:', streamId);
    });

    // Disconnect
    socket.on('disconnect', () => {
        for (const [streamId, stream] of activeStreams.entries()) {
            if (stream.host === socket.id) {
                io.to(`stream-${streamId}`).emit('stream-ended');
                activeStreams.delete(streamId);
                console.log('🔴 Host disconnected, stream ended:', streamId);
            } else if (stream.viewers.has(socket.id)) {
                stream.viewers.delete(socket.id);
                io.to(stream.host).emit('viewer-left', {
                    count: stream.viewers.size
                });
                io.to(`stream-${streamId}`).emit('viewer-count', stream.viewers.size);
            }
        }
    });
});

// API Routes
app.get('/api/streams', async (req, res) => {
    try {
        const snapshot = await db.collection('streams')
            .where('status', '==', 'live')
            .get();

        const streams = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            streams.push({
                id: doc.id,
                title: data.title || 'Untitled',
                description: data.description || '',
                streamerName: data.streamerName || 'Anonymous',
                viewerCount: data.viewerCount || 0,
                createdAt: data.createdAt?.toDate() || new Date()
            });
        });

        res.json(streams);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/streams/:id', async (req, res) => {
    try {
        const doc = await db.collection('streams').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Stream not found' });
        }
        const data = doc.data();
        res.json({
            id: doc.id,
            title: data.title || 'Untitled',
            description: data.description || '',
            streamerName: data.streamerName || 'Anonymous',
            viewerCount: data.viewerCount || 0,
            status: data.status || 'ended'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create stream
app.post('/api/create-stream', async (req, res) => {
    try {
        const { title, description, streamerName } = req.body;

        const streamId = Math.random().toString(36).substring(2, 15);

        const streamData = {
            title: title || 'Untitled Stream',
            description: description || '',
            streamerName: streamerName || 'Anonymous',
            status: 'idle',
            viewerCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('streams').doc(streamId).set(streamData);

        res.json({
            success: true,
            streamId,
            ...streamData
        });
    } catch (error) {
        console.error('Create stream error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`🌐 Open viewer: http://localhost:5500/viewer/`);
    console.log(`🎥 Open host: http://localhost:5500/host/\n`);
});