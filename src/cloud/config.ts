/**
 * Google Drive sync.
 *
 * The OAuth client ID of the Google Cloud project (APIs & Services → Credentials → OAuth client ID,
 * type "Web application", with the site's address as an authorised JavaScript origin, e.g.
 * https://schuster-thomas.github.io and http://localhost:5173 for development – and, for the
 * sign-in in Bluefy that leaves the page for Google, the app's address as an authorised redirect
 * URI: https://schuster-thomas.github.io/storyrower/ and http://localhost:5173/). A client ID is
 * public – it is fine in the code. Empty = Drive sync is off, the icon says it is not set up yet.
 */
export const GOOGLE_CLIENT_ID: string = '179877376000-2o0njr8gkv5aklv1945pd5kcne3r359f.apps.googleusercontent.com';

/**
 * The StoryRower token service (worker/ – a Cloudflare Worker that keeps the client secret). With
 * it, a sign-in lasts: the app renews the hourly access token by itself. Empty = without it, the
 * sign-in runs out after an hour and has to be renewed with a tap.
 */
export const TOKEN_SERVICE: string = 'https://storyrower-auth.storyrower.workers.dev';

/**
 * Only files this app created itself (non-sensitive, no Google review needed), plus the e-mail
 * address to show which account is signed in.
 */
export const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

/** The folder in the user's Drive that holds the trainings and the settings. */
export const DRIVE_FOLDER = 'StoryRower';
