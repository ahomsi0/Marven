// Shared by the server layout and the client i18n setup — keep this module
// free of "use client" so the layout gets the plain string.

export const LANGUAGE_STORAGE_KEY = "marven-app-language";

/** Inline <head> script: apply the saved lang/dir before React hydrates. */
export const LANGUAGE_BOOT_SCRIPT = `try{var l=localStorage.getItem(${JSON.stringify(LANGUAGE_STORAGE_KEY)});if(l==="ar"){document.documentElement.lang="ar";document.documentElement.dir="rtl";}}catch{}`;
