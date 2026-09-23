import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/services/auth.service';

@Component({
  selector: 'app-pantalla-principal',
  templateUrl: './pantalla-principal.component.html',
})
export class PantallaPrincipalComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly theme = this.auth.theme;
  readonly displayName = computed(() => this.auth.user()?.name ?? 'Usuario');

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  toggleTheme(): void {
    this.auth.toggleTheme();
  }
}