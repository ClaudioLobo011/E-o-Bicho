import { forwardRef, SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, className, id, children, ...props }, ref) => {
    const selectId = id ?? props.name ?? `select-${Math.random().toString(36).slice(2, 8)}`;

    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-semibold text-gray-700">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-0 disabled:cursor-not-allowed disabled:bg-gray-100',
            error && 'border-danger-500 focus:border-danger-500 focus:ring-danger-500',
            className
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined}
          {...props}
        >
          {children}
        </select>
        {helperText && !error && (
          <p id={`${selectId}-helper`} className="text-xs text-gray-500">
            {helperText}
          </p>
        )}
        {error && (
          <p id={`${selectId}-error`} className="text-xs font-semibold text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
