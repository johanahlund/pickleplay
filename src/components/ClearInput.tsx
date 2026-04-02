"use client";

interface ClearInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}

export function ClearInput({ value, onChange, placeholder, type = "text", className = "" }: ClearInputProps) {
  return (
    <div className="relative flex-1">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full border border-border rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-primary/50 ${className}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-[10px] text-muted transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );
}
