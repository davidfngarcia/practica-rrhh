import { Injectable, computed, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

export interface User {
  name: string;
}

const STORAGE_KEYS = {
  user: 'rrhh.user',
  theme: 'rrhh.theme',
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSignal = signal<User | null>(this.read<User>(STORAGE_KEYS.user));
  private readonly themeSignal = signal<Theme>((this.read<Theme>(STORAGE_KEYS.theme) as Theme) ?? 'light');

  readonly user = this.userSignal.asReadonly();
  readonly theme = this.themeSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.userSignal() !== null);

  login(username: string): void {
    const user: User = { name: username.trim() };
    this.userSignal.set(user);
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  }

  logout(): void {
    this.userSignal.set(null);
    localStorage.removeItem(STORAGE_KEYS.user);
  }

  toggleTheme(): void {
    this.themeSignal.update((theme) => (theme === 'light' ? 'dark' : 'light'));
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(this.themeSignal()));
  }

  private read<T>(key: string): T | null {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}