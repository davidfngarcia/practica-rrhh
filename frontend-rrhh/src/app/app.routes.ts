import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { LoginComponent } from './auth/login/login.component';
import { PantallaPrincipalComponent } from './pantalla-principal/pantalla-principal.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  {
    path: 'pantalla-principal',
    component: PantallaPrincipalComponent,
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'login' },
];