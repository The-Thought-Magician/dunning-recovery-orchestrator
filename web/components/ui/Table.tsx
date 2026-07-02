import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'

export function Table({ className = '', children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={`w-full border-collapse text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  )
}

export function THead({ className = '', children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`border-b border-zinc-800 text-left ${className}`} {...props}>
      {children}
    </thead>
  )
}

export function TBody({ className = '', children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={`divide-y divide-zinc-800/70 ${className}`} {...props}>
      {children}
    </tbody>
  )
}

export function TR({ className = '', children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`hover:bg-zinc-800/30 ${className}`} {...props}>
      {children}
    </tr>
  )
}

export function TH({ className = '', children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 ${className}`} {...props}>
      {children}
    </th>
  )
}

export function TD({ className = '', children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 text-zinc-300 ${className}`} {...props}>
      {children}
    </td>
  )
}

export default Table
