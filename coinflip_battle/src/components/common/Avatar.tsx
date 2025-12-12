import React from 'react';

interface AvatarProps {
  src?: string;
  seed?: string;
  alt?: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  seed,
  alt = "Avatar",
  size = 'medium',
  className = ''
}) => {
  const avatarSrc = src || `https://api.dicebear.com/9.x/pixel-art-neutral/svg?seed=${seed || 'default'}`;

  const sizeClasses = {
    small: 'w-8 h-8',
    medium: 'w-10 h-10',
    large: 'w-16 h-16' // Standardized size for consistency
  };

  return (
    <img
      src={avatarSrc}
      alt={alt}
      className={`${sizeClasses[size]} rounded-full border-2 border-white/[0.2] ${className}`}
    />
  );
};