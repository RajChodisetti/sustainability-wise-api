import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

interface BaseFieldProps {
  label: string;
  hint?: string;
  error?: string;
}

interface TextFieldProps extends BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'date' | 'number';
  multiline?: boolean;
  disabled?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  type = 'text',
  multiline = false,
  disabled = false,
}: TextFieldProps) {
  const id = useMemo(() => `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);
  return (
    <label className="field-control" htmlFor={id}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint && <small>{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

interface SelectFieldProps extends BaseFieldProps {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SelectField({ label, hint, error, value, options, onChange, disabled = false }: SelectFieldProps) {
  const id = useMemo(() => `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);
  return (
    <label className="field-control" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <small>{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

interface ToggleFieldProps extends BaseFieldProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleField({ label, hint, checked, onChange, disabled = false }: ToggleFieldProps) {
  return (
    <label className="toggle-field">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-box" aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

interface PhotoUploadFieldProps extends BaseFieldProps {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
}

export function PhotoUploadField({
  label,
  hint,
  files,
  onChange,
  multiple = false,
  disabled = false,
}: PhotoUploadFieldProps) {
  const previews = useMemo(() => files.map((file) => ({
    file,
    url: URL.createObjectURL(file),
  })), [files]);

  return (
    <div className="photo-upload">
      <label className="upload-drop">
        <ImagePlus aria-hidden="true" />
        <span>{label}</span>
        {hint && <small>{hint}</small>}
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          disabled={disabled}
          onChange={(event) => onChange(Array.from(event.target.files ?? []))}
        />
      </label>
      {previews.length > 0 && (
        <div className="photo-preview-grid">
          {previews.map(({ file, url }) => (
            <figure key={`${file.name}-${file.lastModified}`}>
              <img src={url} alt={file.name} />
              <figcaption>{file.name}</figcaption>
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((item) => item !== file))}
              >
                <X aria-hidden="true" />
              </button>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

interface RepeatedSectionProps<T> {
  title: string;
  items: T[];
  addLabel: string;
  renderItem: (item: T, index: number) => ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export function RepeatedSection<T>({ title, items, addLabel, renderItem, onAdd, onRemove }: RepeatedSectionProps<T>) {
  return (
    <section className="repeated-section">
      <header>
        <h3>{title}</h3>
        <button className="button secondary icon-text" type="button" onClick={onAdd}>
          <Plus aria-hidden="true" />
          {addLabel}
        </button>
      </header>
      <div className="repeated-list">
        {items.map((item, index) => (
          <article className="repeated-item" key={index}>
            <button
              className="icon-button"
              type="button"
              aria-label={`Remove item ${index + 1}`}
              onClick={() => onRemove(index)}
            >
              <Trash2 aria-hidden="true" />
            </button>
            {renderItem(item, index)}
          </article>
        ))}
      </div>
    </section>
  );
}
