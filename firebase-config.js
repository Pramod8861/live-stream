// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBEY1V9m8UIkgWUKJIbdhUuQKCo2I4rztM",
    authDomain: "live-stream-7b16a.firebaseapp.com",
    databaseURL: "https://live-stream-7b16a-default-rtdb.firebaseio.com",
    projectId: "live-stream-7b16a",
    storageBucket: "live-stream-7b16a.firebasestorage.app",
    messagingSenderId: "13367877746",
    appId: "1:13367877746:web:7950e063fee3c01109a2eb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Enable persistence for offline support
db.enablePersistence()
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('Multiple tabs open, persistence enabled in one tab only');
        } else if (err.code == 'unimplemented') {
            console.log('Browser doesn\'t support persistence');
        }
    });