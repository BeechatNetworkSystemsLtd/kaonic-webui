import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/api';
import { useLogin } from '@/data/queries';
import { Button, Field, Input, Notice } from '@/ui';
import { AuthLayout } from './AuthLayout';
import { ForgotDialog } from './ForgotDialog';
import styles from './Auth.module.css';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const login = useLogin();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate(password);
  }

  return (
    <AuthLayout title="Sign in" description="Enter the password of this Kaonic device.">
      <form className={styles.form} onSubmit={onSubmit}>
        <Field label="Password">
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        {login.isError ? <Notice tone="danger">{errorMessage(login.error)}</Notice> : null}
        <Button type="submit" variant="primary" block busy={login.isPending}>
          Sign in
        </Button>
        <button type="button" className={styles.forgot} onClick={() => setForgot(true)}>
          Forgot the password?
        </button>
      </form>
      {forgot ? <ForgotDialog onClose={() => setForgot(false)} /> : null}
    </AuthLayout>
  );
}
