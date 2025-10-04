import { Button } from './Button';

interface PaginationProps {
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function Pagination({ canPrevious, canNext, onPrevious, onNext }: PaginationProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onPrevious}
        disabled={!canPrevious}
        aria-label="Página anterior"
      >
        <i className="fa-solid fa-chevron-left" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onNext}
        disabled={!canNext}
        aria-label="Próxima página"
      >
        <i className="fa-solid fa-chevron-right" aria-hidden />
      </Button>
    </div>
  );
}
