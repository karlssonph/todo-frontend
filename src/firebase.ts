import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAHA3PgELtosfER5hNIMV1T3MY85Q9zktw",
  authDomain: "todo-app-8613d.firebaseapp.com",
  projectId: "todo-app-8613d",
  storageBucket: "todo-app-8613d.firebasestorage.app",
  messagingSenderId: "714879238603",
  appId: "1:714879238603:web:24c60ae6909154fc95764e",
  measurementId: "G-D5PV60D5M1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);
