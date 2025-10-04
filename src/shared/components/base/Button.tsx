import React, { ButtonHTMLAttributes, ReactElement, cloneElement, forwardRef } from 'react';
import { cn } from '../../lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary/90 focus-visible:outline-primary disabled:bg-primary/50 disabled:text-white/80',
  secondary:
    'bg-secondary text-white hover:bg-secondary/90 focus-visible:outline-secondary disabled:bg-secondary/60',
  ghost:
    'bg-transparent text-secondary hover:bg-secondary/10 focus-visible:outline-secondary disabled:text-secondary/50',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 focus-visible:outline-danger-600 disabled:bg-danger-400'
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg'
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    className,
    variant = 'primary',
    size = 'md',
    leftIcon,
    rightIcon,
    children,
    asChild,
    type,
    ...props
  }, ref) => {
    const classes = cn(
      'inline-flex items-center justify-center rounded-md font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-70',
      variantClasses[variant],
      sizeClasses[size],
      className
    );

    if (asChild && React.isValidElement(children)) {
      return cloneElement(children as ReactElement, {
        className: cn(children.props.className, classes),
        ref,
        ...props
      });
    }

    return (
      <button ref={ref} className={classes} type={type} {...props}>
        {leftIcon && <span className="mr-2 flex items-center" aria-hidden>{leftIcon}</span>}
        {children}
        {rightIcon && <span className="ml-2 flex items-center" aria-hidden>{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
