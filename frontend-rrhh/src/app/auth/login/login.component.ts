import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly showPassword = signal(false);
  protected username = '';
  protected password = '';
  protected submitted = false;

  readonly theme = this.auth.theme;

  toggleTheme(): void {
    this.auth.toggleTheme();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  onSubmit(): void {
    if (!this.username.trim() || !this.password.trim()) {
      this.submitted = true;
      return;
    }
    this.auth.login(this.username);
    this.router.navigate(['/pantalla-principal']);
  }
}