import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, isSupported } from 'firebase/messaging';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCMWwiVBCe5xNS3xQdp82-ArSzJknu4ZmI",
  authDomain: "hr-portal-e336a.firebaseapp.com",
  projectId: "hr-portal-e336a",
  storageBucket: "hr-portal-e336a.firebasestorage.app",
  messagingSenderId: "1078654559369",
  appId: "1:1078654559369:web:72509c018f4f283f255258"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

let _messaging = null;
export const getMessagingInstance = async () => {
  if (_messaging) return _messaging;
  const ok = await isSupported().catch(() => false);
  if (ok) _messaging = getMessaging(app);
  return _messaging;
};
