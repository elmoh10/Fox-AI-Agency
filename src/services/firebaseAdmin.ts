import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import firebaseConfig from "../../firebase-applet-config.json";

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  firebaseConfig.projectId;

const databaseId =
  (firebaseConfig as any).firestoreDatabaseId ||
  "(default)";

const serviceAccountJson =
  process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim();

let credential;

if (serviceAccountJson) {
  const serviceAccount =
    JSON.parse(serviceAccountJson);

  credential =
    cert(serviceAccount);

  console.log(
    "🔐 [Firebase Admin] Using encrypted service-account environment variable"
  );
} else {
  credential =
    applicationDefault();

  console.log(
    "🔐 [Firebase Admin] Using Application Default Credentials fallback"
  );
}

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential,
        projectId,
      });

export const adminAuth =
  getAuth(adminApp);

export const adminDb =
  databaseId === "(default)"
    ? getFirestore(adminApp)
    : getFirestore(
        adminApp,
        databaseId
      );

console.log(
  `🔐 [Firebase Admin] Initialized | Project=${projectId} | Database=${databaseId}`
);
