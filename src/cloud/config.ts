/**
 * Google Drive sync.
 *
 * The OAuth client ID of the Google Cloud project (APIs & Services → Credentials → OAuth client ID,
 * type "Web application", with the site's address as an authorised JavaScript origin, e.g.
 * https://schuster-thomas.github.io and http://localhost:5173 for development). A client ID is
 * public – it is fine in the code. Empty = Drive sync is off, the icon says it is not set up yet.
 */
export const GOOGLE_CLIENT_ID = '';

/**
 * Only files this app created itself (non-sensitive, no Google review needed), plus the e-mail
 * address to show which account is signed in.
 */
export const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

/** The folder in the user's Drive that holds the trainings and the settings. */
export const DRIVE_FOLDER = 'StoryRower';
