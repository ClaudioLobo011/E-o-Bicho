import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const inputId = id ?? props.name ?? `input-${Math.random().toString(36).slice(2, 8)}`;

    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-semibold text-gray-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-0 disabled:cursor-not-allowed disabled:bg-gray-100',
            error && 'border-danger-500 focus:border-danger-500 focus:ring-danger-500',
            className
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          {...props}
        />
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="text-xs text-gray-500">
            {helperText}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} className="text-xs font-semibold text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
