// Inside processSale async function, after creating newSale and before fetching data, add commission creation and persistence
const totalComissao = saleData.itens.reduce((acc: number, item: any) => {
  const p = products.find(prod => prod.id === item.produtoId);
  return acc + (item.precoVenda * item.quantidade * ((p?.comissaoPercentual || 0) / 100));
}, 0);

const newCommission = {
  saleId: newSale.id,
  vendedorId: saleData.vendedorId,
  valor: Number(totalComissao.toFixed(2)),
  status: saleData.statusPagamento === 'PAGO' ? 'DISPONIVEL' : 'A_RECEBER',
  dataGeracao: new Date()
};

const commissionInserted = await commissionService.insertCommission(newCommission);
if (commissionInserted) {
  // Add to local commissions state
  setCommissions(prev => [...prev, { ...newCommission, id: newCommission.saleId }]);
  // Show toast notification for new commission
  setAdminNotification('Comissão gerada com sucesso');
}