with open('app/employees/employee-list.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
print(f"renderDocUpload occurrences: {c.count('renderDocUpload')}")
print(f"renderDocUpload definitions: {c.count('const renderDocUpload')}")
for word in ['passportDocDraft', 'ibanDocDraft', 'labourDocDraft', 'residenceDocDraft', 'medicalDocDraft', 'iloeDocDraft']:
    cnt = c.count(f'const [{word}')
    print(f'{word} definitions: {cnt}')
