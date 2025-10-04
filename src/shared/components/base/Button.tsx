import React, { ButtonHTMLAttributes, ReactElement, cloneElement, forwardRef } from 'react';
import { cn } from '../../lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  outline: 'btn-outline'
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg'
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
    const classes = cn('btn', variantClasses[variant], sizeClasses[size], className);

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
