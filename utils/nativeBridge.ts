/**
 * nativeBridge.ts - Camada de compatibilidade Web / APK
 * Tenta funcionalidades nativas (Web2APK bridge), cai para Web APIs.
 */

declare global {
  interface Window {
    Web2APK?: {
      bluetoothPrint?: (base64Data: string) => Promise<boolean>;
      vibrate?: (pattern: number | number[]) => void;
      hapticImpact?: (style: 'light' | 'medium' | 'heavy') => void;
      share?: (text: string, title?: string) => Promise<void>;
      pushRegister?: () => Promise<string>;
      biometricAuth?: (prompt: string) => Promise<boolean>;
      setStatusBarColor?: (color: string) => void;
      getGPSLocation?: () => Promise<{ lat: number; lng: number } | null>;
    };
  }
}

export const nativeBridge = {
  vibrate(pattern: number | number[] = 100): void {
    try {
      if (window.Web2APK?.vibrate) { window.Web2APK.vibrate(pattern); return; }
      if (navigator.vibrate) { navigator.vibrate(pattern); }
    } catch (e) {}
  },

  hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium'): void {
    try {
      if (window.Web2APK?.hapticImpact) { window.Web2APK.hapticImpact(style); return; }
      const d = { light: 10, medium: 25, heavy: 50 };
      if (navigator.vibrate) navigator.vibrate(d[style]);
    } catch (e) {}
  },

  async share(text: string, title?: string): Promise<boolean> {
    try {
      if (navigator.share) { await navigator.share({ title: title || 'Compartilhar', text }); return true; }
      if (window.Web2APK?.share) { await window.Web2APK.share(text, title); return true; }
      return false;
    } catch (e) { return false; }
  },

  async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta); return ok;
    } catch (e) { return false; }
  },

  async bluetoothPrint(rawText: string): Promise<boolean> {
    try {
      if (window.Web2APK?.bluetoothPrint) { return await window.Web2APK.bluetoothPrint(btoa(rawText)); }
      return false;
    } catch (e) { return false; }
  },

  openWhatsApp(phone: string, message?: string): void {
    const clean = phone.replace(/\D/g, '');
    const url = message ? `https://wa.me/55${clean}?text=${encodeURIComponent(message)}` : `https://wa.me/55${clean}`;
    window.open(url, '_blank');
  },

  openNavigation(lat: number, lng: number, label?: string): void {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, '_blank');
  },

  async getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
    try {
      if (window.Web2APK?.getGPSLocation) return await window.Web2APK.getGPSLocation();
      return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    } catch (e) { return null; }
  },

  async biometricAuth(prompt: string = 'Confirme sua identidade'): Promise<boolean> {
    try { if (window.Web2APK?.biometricAuth) return await window.Web2APK.biometricAuth(prompt); return false; } catch (e) { return false; }
  },

  setStatusBarColor(color: string): void {
    try { if (window.Web2APK?.setStatusBarColor) window.Web2APK.setStatusBarColor(color); } catch (e) {}
  },

  async registerPushNotifications(): Promise<string | null> {
    try {
      if (window.Web2APK?.pushRegister) return await window.Web2APK.pushRegister();
      return null;
    } catch (e) { return null; }
  },

  isNative(): boolean { return !!window.Web2APK; },
  isOnline(): boolean { return navigator.onLine; }
};

export default nativeBridge;
